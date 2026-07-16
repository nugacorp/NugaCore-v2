// ====================================================================
// WireGuard Manager Service (Fase 4.6.1 + host-apply 2026-07).
//
// Orquesta generación de claves + IPAM + cifrado + repositorio. Expone vistas
// SANEADAS (sin secretos) y devuelve secretos (private/preshared key) UNA sola
// vez al crear/rotar. No ejecuta nada en routers.
//
// Tras create/rotate/revoke: sincroniza peers activos al host wg0 vía
// host-apply (ver host-apply.ts y docs/wireguard/WIREGUARD_HOST_APPLY.md).
// ====================================================================

import { encryptSecret, decryptSecret } from '../../services/crypto';
import { logger } from '../../common/logger';
import { useDbWireguard } from '../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../common/errors';
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
import {
  configureHostApplyPeerLoader,
  flushHostPeerSync,
} from './host-apply';

/** CIDR de gestión/API: preferir el pool del servidor WG, no un default desalineado. */
const peerAllowedCidr = (server: WireguardServerRecord, override?: string): string =>
  override || server.vpnCidr || process.env.MIKROTIK_MGMT_CIDR || DEFAULT_WG_POOL;

export interface CreateServerInput {
  name: string;
  endpointHost: string;
  endpointPort?: number;
  listenPort?: number;
  vpnCidr?: string;
  serverVpnIp?: string;
  isDefault?: boolean;
  tenantId?: string;
}

export interface CreatePeerInput {
  serverId: string;
  name: string;
  routerId?: string;
  allowedCidr?: string;
  tenantId?: string;
}

export class WireguardService {
  constructor(private readonly repo: WireguardRepository) {
    // Host-apply es PLATFORM-GLOBAL: todos los peers activos de todos los
    // tenants → un solo wg0. Nunca filtrar por tenant aquí (si no, un revoke
    // de tenant A borraría peers de B en el reconcile full).
    configureHostApplyPeerLoader(async () => {
      const peers = await this.repo.listPeers({ status: 'active' });
      return peers.map((p) => ({
        publicKey: p.publicKey,
        allocatedIp: p.allocatedIp,
        name: p.name,
      }));
    });
  }

  /** Sincroniza peers activos → host wg0 (await). No falla el flujo de negocio. */
  private async syncHostAfterMutation(reason: string): Promise<void> {
    try {
      const result = await flushHostPeerSync();
      if (!result.ok && !result.skipped) {
        logger.warn('WireGuard: host-apply no aplicado tras mutación', {
          reason,
          detail: result.detail,
        });
      }
    } catch (err) {
      logger.warn('WireGuard: host-apply error tras mutación', {
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
      allowedCidr: peer.allowedCidr || server.vpnCidr,
    };
  }

  // ── servidores ──────────────────────────────────────────────────────
  async listServers(tenantId?: string): Promise<WireguardServerView[]> {
    const servers = await this.repo.listServers(tenantId);
    const peers = await this.repo.listPeers(tenantId ? { tenantId } : undefined);
    return servers.map((s) => this.toServerView(s, peers.filter((p) => p.serverId === s.id && p.status === 'active').length));
  }

  /** Servidor WireGuard por defecto del tenant (o null). */
  async getDefaultServer(tenantId?: string): Promise<WireguardServerView | null> {
    const rec = await this.repo.getDefaultServer(tenantId);
    if (!rec) return null;
    const peers = await this.repo.listPeers({ serverId: rec.id, status: 'active', tenantId });
    return this.toServerView(rec, peers.length);
  }

  /**
   * Vista previa de la siguiente IP libre del pool (sin reservar).
   * Para mostrar al operador antes de registrar un router WireGuard.
   */
  async previewNextIp(serverId?: string, tenantId?: string): Promise<{ ip: string; serverId: string; serverName: string; preview: true }> {
    const rec = serverId
      ? await this.repo.getServer(serverId, tenantId)
      : await this.repo.getDefaultServer(tenantId);
    if (!rec) throw new NotFoundError('No hay servidor WireGuard configurado.');
    const allocations = await this.repo.listAllocations(rec.id);
    const ip = nextFreeIp(
      allocations.map((a) => ({ ip: a.ip, status: a.status })),
      rec.vpnCidr,
      [rec.serverVpnIp],
    );
    if (!ip) throw new Error('WireGuard IP pool exhausted');
    return { ip, serverId: rec.id, serverName: rec.name, preview: true };
  }

  async createServer(input: CreateServerInput): Promise<ServerCreatedOnce> {
    const tenantId = input.tenantId || 'tenant-default';
    // Si este servidor es default, quitar el default anterior del mismo tenant.
    if (input.isDefault) {
      const prev = await this.repo.getDefaultServer(tenantId);
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
      tenantId,
      status: 'active', createdAt: nowIso(), updatedAt: nowIso(),
    };
    await this.repo.createServer(rec);
    logger.info('WireGuard: servidor creado', { serverId: id, name: rec.name, isDefault: rec.isDefault, tenantId });
    return { server: this.toServerView(rec, 0), serverPrivateKey: kp.privateKey };
  }

  /** Busca un servidor por ID y devuelve su vista, o null si no existe. */
  async findServer(id: string, tenantId?: string): Promise<WireguardServerView | null> {
    const rec = await this.repo.getServer(id, tenantId);
    if (!rec) return null;
    const peers = await this.repo.listPeers({ serverId: rec.id, status: 'active', tenantId });
    return this.toServerView(rec, peers.length);
  }

  // ── peers ─────────────────────────────────────────────────────────────
  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string; tenantId?: string }): Promise<WireguardPeerView[]> {
    return (await this.repo.listPeers(filter)).map((p) => this.toPeerView(p));
  }

  async createPeer(input: CreatePeerInput, actorId?: string): Promise<PeerCreatedOnce> {
    const tenantId = input.tenantId || 'tenant-default';
    const server = await this.repo.getServer(input.serverId, tenantId);
    if (!server) throw new NotFoundError(`Servidor WireGuard '${input.serverId}' no encontrado.`);

    const allocations = await this.repo.listAllocations(server.id);
    const ip = nextFreeIp(allocations.map((a) => ({ ip: a.ip, status: a.status })), server.vpnCidr, [server.serverVpnIp]);
    if (!ip) {
      throw new BadRequestError(
        'Pool de IPs WireGuard agotado para este servidor.',
        'WIREGUARD_IP_POOL_EXHAUSTED',
      );
    }

    const kp = generateWgKeyPair();
    const psk = generatePresharedKey();
    const id = await this.repo.nextId('peer');
    const rec: WireguardPeerRecord = {
      id, serverId: server.id, routerId: input.routerId, name: input.name, publicKey: kp.publicKey,
      encryptedPrivateKey: encryptSecret(kp.privateKey), encryptedPresharedKey: encryptSecret(psk),
      encryptionVersion: ENCRYPTION_VERSION, allocatedIp: ip, allowedCidr: peerAllowedCidr(server, input.allowedCidr),
      tenantId,
      status: 'active', createdBy: actorId, createdAt: nowIso(), updatedAt: nowIso(),
    };
    await this.repo.createPeer(rec);

    // Unique (server_id, ip) en Supabase: si la IP estaba released, UPDATE la fila;
    // no INSERT (provocaba 500: duplicate key wireguard_ip_allocations_server_id_ip_key).
    const existingAlloc = allocations.find((a) => a.ip === ip);
    if (existingAlloc) {
      await this.repo.updateAllocation(existingAlloc.id, {
        status: 'allocated',
        peerId: id,
        releasedAt: '',
        allocatedAt: nowIso(),
      });
    } else {
      const allocId = await this.repo.nextId('alloc');
      await this.repo.createAllocation({
        id: allocId,
        serverId: server.id,
        ip,
        peerId: id,
        status: 'allocated',
        allocatedAt: nowIso(),
      });
    }

    logger.info('WireGuard: peer creado', {
      peerId: id,
      serverId: server.id,
      ip,
      reusedAllocation: Boolean(existingAlloc),
    });
    // Await: el WISP debe poder importar el .rsc con el peer ya en wg0.
    await this.syncHostAfterMutation('createPeer');
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
    // Full reconcile: quita pubkey vieja y aplica la nueva (evita peers huérfanos).
    await this.syncHostAfterMutation('rotatePeer');
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
    await this.syncHostAfterMutation('revokePeer');
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
