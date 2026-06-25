// ====================================================================
// WireGuard Manager Service (Fase 4.6.1).
//
// Orquesta generación de claves + IPAM + cifrado + repositorio. Expone vistas
// SANEADAS (sin secretos) y devuelve secretos (private/preshared key) UNA sola
// vez al crear/rotar. No ejecuta nada en routers.
// ====================================================================

import { encryptSecret, decryptSecret } from '../../services/crypto';
import { logger } from '../../common/logger';
import { useDbWireguard } from '../../config/feature-flags';
import { NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { generatePresharedKey, generateWgKeyPair } from './keys';
import { DEFAULT_SERVER_IP, DEFAULT_WG_POOL, nextFreeIp } from './ipam';
import {
  StoreWireguardRepository,
  SupabaseWireguardRepository,
  WireguardRepository,
} from './repository';
import {
  ENCRYPTION_VERSION,
  PeerCreatedOnce,
  ServerCreatedOnce,
  WireguardPeerRecord,
  WireguardPeerView,
  WireguardServerRecord,
  WireguardServerView,
} from './types';

import { nowIso } from '../../common/time';
const mgmtCidr = () => process.env.MIKROTIK_MGMT_CIDR || '10.0.0.0/24';

export interface CreateServerInput {
  name: string;
  endpointHost: string;
  endpointPort?: number;
  listenPort?: number;
  vpnCidr?: string;
  serverVpnIp?: string;
  isDefault?: boolean;
}

export interface CreatePeerInput {
  serverId: string;
  name: string;
  routerId?: string;
  allowedCidr?: string;
}

export class WireguardService {
  constructor(private readonly repo: WireguardRepository) {}

  // ── saneado ────────────────────────────────────────────────────────
  private toServerView(rec: WireguardServerRecord, peersCount: number): WireguardServerView {
    return {
      id: rec.id, name: rec.name, endpointHost: rec.endpointHost, endpointPort: rec.endpointPort,
      listenPort: rec.listenPort, publicKey: rec.publicKey, vpnCidr: rec.vpnCidr, serverVpnIp: rec.serverVpnIp,
      isDefault: rec.isDefault, status: rec.status, peersCount, createdAt: rec.createdAt, updatedAt: rec.updatedAt,
    };
  }
  private toPeerView(rec: WireguardPeerRecord): WireguardPeerView {
    return {
      id: rec.id, serverId: rec.serverId, routerId: rec.routerId, name: rec.name, publicKey: rec.publicKey,
      allocatedIp: rec.allocatedIp, allowedCidr: rec.allowedCidr, status: rec.status,
      hasSecrets: !!rec.encryptedPrivateKey, lastRotatedAt: rec.lastRotatedAt, revokedAt: rec.revokedAt,
      createdAt: rec.createdAt,
    };
  }

  private peerOnce(server: WireguardServerRecord, peer: WireguardPeerRecord, privateKey: string, presharedKey: string): PeerCreatedOnce {
    return {
      peer: this.toPeerView(peer),
      privateKey,
      presharedKey,
      serverPublicKey: server.publicKey,
      serverEndpoint: `${server.endpointHost}:${server.endpointPort}`,
      assignedIp: `${peer.allocatedIp}/32`,
      allowedCidr: peer.allowedCidr || mgmtCidr(),
    };
  }

  // ── servidores ──────────────────────────────────────────────────────
  async listServers(): Promise<WireguardServerView[]> {
    const servers = await this.repo.listServers();
    const peers = await this.repo.listPeers();
    return servers.map((s) => this.toServerView(s, peers.filter((p) => p.serverId === s.id && p.status === 'active').length));
  }

  async createServer(input: CreateServerInput): Promise<ServerCreatedOnce> {
    // Si este servidor es default, quitar el default anterior.
    if (input.isDefault) {
      const prev = await this.repo.getDefaultServer();
      if (prev) await this.repo.updateServer(prev.id, { isDefault: false });
    }
    const kp = generateWgKeyPair();
    const id = await this.repo.nextId('server');
    const rec: WireguardServerRecord = {
      id, name: input.name, endpointHost: input.endpointHost,
      endpointPort: input.endpointPort || 13231, listenPort: input.listenPort || input.endpointPort || 13231,
      publicKey: kp.publicKey, encryptedPrivateKey: encryptSecret(kp.privateKey), encryptionVersion: ENCRYPTION_VERSION,
      vpnCidr: input.vpnCidr || DEFAULT_WG_POOL, serverVpnIp: input.serverVpnIp || DEFAULT_SERVER_IP,
      isDefault: input.isDefault ?? false,
      status: 'active', createdAt: nowIso(), updatedAt: nowIso(),
    };
    await this.repo.createServer(rec);
    logger.info('WireGuard: servidor creado', { serverId: id, name: rec.name, isDefault: rec.isDefault });
    return { server: this.toServerView(rec, 0), serverPrivateKey: kp.privateKey };
  }

  /** Devuelve la vista del servidor default activo, o null si no existe. */
  async getDefaultServer(): Promise<WireguardServerView | null> {
    const rec = await this.repo.getDefaultServer();
    if (!rec) return null;
    const peers = await this.repo.listPeers({ serverId: rec.id, status: 'active' });
    return this.toServerView(rec, peers.length);
  }

  /** Busca un servidor por ID y devuelve su vista, o null si no existe. */
  async findServer(id: string): Promise<WireguardServerView | null> {
    const rec = await this.repo.getServer(id);
    if (!rec) return null;
    const peers = await this.repo.listPeers({ serverId: rec.id, status: 'active' });
    return this.toServerView(rec, peers.length);
  }

  // ── peers ─────────────────────────────────────────────────────────────
  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string }): Promise<WireguardPeerView[]> {
    return (await this.repo.listPeers(filter)).map((p) => this.toPeerView(p));
  }

  async createPeer(input: CreatePeerInput, actorId?: string): Promise<PeerCreatedOnce> {
    const server = await this.repo.getServer(input.serverId);
    if (!server) throw new NotFoundError(`Servidor WireGuard '${input.serverId}' no encontrado.`);

    const allocations = await this.repo.listAllocations(server.id);
    const ip = nextFreeIp(allocations.map((a) => ({ ip: a.ip, status: a.status })), server.vpnCidr, [server.serverVpnIp]);
    if (!ip) throw new Error('WireGuard IP pool exhausted');

    const kp = generateWgKeyPair();
    const psk = generatePresharedKey();
    const id = await this.repo.nextId('peer');
    const rec: WireguardPeerRecord = {
      id, serverId: server.id, routerId: input.routerId, name: input.name, publicKey: kp.publicKey,
      encryptedPrivateKey: encryptSecret(kp.privateKey), encryptedPresharedKey: encryptSecret(psk),
      encryptionVersion: ENCRYPTION_VERSION, allocatedIp: ip, allowedCidr: input.allowedCidr || mgmtCidr(),
      status: 'active', createdBy: actorId, createdAt: nowIso(), updatedAt: nowIso(),
    };
    await this.repo.createPeer(rec);
    const allocId = await this.repo.nextId('alloc');
    await this.repo.createAllocation({ id: allocId, serverId: server.id, ip, peerId: id, status: 'allocated', allocatedAt: nowIso() });
    logger.info('WireGuard: peer creado', { peerId: id, serverId: server.id, ip });
    return this.peerOnce(server, rec, kp.privateKey, psk);
  }

  async rotatePeer(peerId: string, actorId?: string, reason?: string): Promise<PeerCreatedOnce | null> {
    const peer = await this.repo.getPeer(peerId);
    if (!peer || peer.status !== 'active') return null;
    const server = await this.repo.getServer(peer.serverId);
    if (!server) return null;

    const kp = generateWgKeyPair();
    const psk = generatePresharedKey();
    const oldPub = peer.publicKey;
    const updated = await this.repo.updatePeer(peerId, {
      publicKey: kp.publicKey,
      encryptedPrivateKey: encryptSecret(kp.privateKey),
      encryptedPresharedKey: encryptSecret(psk),
      lastRotatedAt: nowIso(),
    });
    const rotId = await this.repo.nextId('rotation');
    await this.repo.recordRotation({ id: rotId, peerId, oldPublicKey: oldPub, newPublicKey: kp.publicKey, reason, actorId, createdAt: nowIso() });
    logger.info('WireGuard: peer rotado', { peerId, serverId: server.id });
    return this.peerOnce(server, updated!, kp.privateKey, psk);
  }

  async revokePeer(peerId: string): Promise<boolean> {
    const peer = await this.repo.getPeer(peerId);
    if (!peer) return false;
    await this.repo.updatePeer(peerId, { status: 'revoked', revokedAt: nowIso() });
    // Liberar la IP para reutilización.
    const allocations = await this.repo.listAllocations(peer.serverId);
    const alloc = allocations.find((a) => a.ip === peer.allocatedIp && a.status === 'allocated');
    if (alloc) await this.repo.updateAllocation(alloc.id, { status: 'released', releasedAt: nowIso() });
    logger.info('WireGuard: peer revocado', { peerId });
    return true;
  }

  async listRotations(peerId?: string) {
    return this.repo.listRotations(peerId);
  }

  /**
   * Integración con provisioning: devuelve la config del peer del router para
   * un servidor. Si ya existe un peer activo, reusa su configuración
   * (descifra los secretos para incrustarlos en el script). Si no, lo crea.
   */
  async getPeerConfigForRouter(routerId: string, serverId: string, actorId?: string): Promise<PeerCreatedOnce> {
    const existing = (await this.repo.listPeers({ serverId, routerId, status: 'active' }))[0];
    if (!existing) return this.createPeer({ serverId, name: `router-${routerId}`, routerId }, actorId);
    const server = await this.repo.getServer(serverId);
    if (!server) throw new NotFoundError(`Servidor WireGuard '${serverId}' no encontrado.`);
    const privateKey = existing.encryptedPrivateKey ? decryptSecret(existing.encryptedPrivateKey) : '';
    const presharedKey = existing.encryptedPresharedKey ? decryptSecret(existing.encryptedPresharedKey) : '';
    return this.peerOnce(server, existing, privateKey, presharedKey);
  }
}

// ── Factoría ────────────────────────────────────────────────────────────
let singleton: WireguardService | null = null;

// Delegado a la fuente central de feature flags (ARCH-1). Comportamiento idéntico.
const useDb = (): boolean => useDbWireguard();

const build = (): WireguardService => {
  if (useDb()) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error('USE_DB_WIREGUARD=true pero Supabase no está configurado.');
    }
    logger.info('WireGuard Manager: persistencia = Supabase (USE_DB_WIREGUARD=true)');
    return new WireguardService(new SupabaseWireguardRepository(supabaseAdmin));
  }
  logger.info('WireGuard Manager: persistencia = store en memoria (USE_DB_WIREGUARD=false)');
  return new WireguardService(new StoreWireguardRepository());
};

export const getWireguardService = (): WireguardService => {
  if (!singleton) singleton = build();
  return singleton;
};

/** Sólo tests: reconstruye el singleton. */
export const resetWireguardService = (): void => { singleton = null; };
