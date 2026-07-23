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
import { useDbWireguard, isWireguardMultitenantEnabled } from '../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { DEFAULT_TENANT_ID } from '../tenancy/types';
import { generatePresharedKey, generateWgKeyPair } from './keys';
import { DEFAULT_SERVER_IP, DEFAULT_WG_POOL, nextFreeIp, nextFreeIpInCidr } from './ipam';
import {
  StoreWireguardRepository,
  SupabaseWireguardRepository,
  WireguardRepository,
} from './repository';
import {
  ApplyState,
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
  AppliedStateSnapshot,
  DesiredWgState,
  HostApplyResult,
  checkHostCapacity,
  configureHostApplyStateLoader,
  flushHostPeerSync,
} from './host-apply';

/** Deriva el /24 canónico del bloque a partir de una IP del túnel. */
const subnetFromIp = (ip: string): string => {
  const [a, b, c] = ip.split('/')[0].split('.');
  return `${a}.${b}.${c}.0/24`;
};

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
    configureHostApplyStateLoader(
      () => this.loadDesiredState(),
      (result, snapshot) => this.ackAppliedState(result, snapshot),
    );
  }

  /**
   * Estado deseado para el host. Con el flag apagado replica el payload v1
   * actual (peers sueltos, sin subredes/PSK/revisión) — sin consultas extra.
   * Con el flag encendido añade PSK cifrada + tenantSubnet por peer + el
   * conjunto de tenantSubnets y la revisión monotónica persistida.
   */
  private async loadDesiredState(): Promise<DesiredWgState> {
    const peers = await this.repo.listPeers({ status: 'active' });
    if (!isWireguardMultitenantEnabled()) {
      return {
        peers: peers.map((p) => ({ id: p.id, publicKey: p.publicKey, allocatedIp: p.allocatedIp, name: p.name })),
        tenantSubnets: [],
        revision: 0,
      };
    }
    const subnets = await this.repo.listSubnets();
    const revision = await this.repo.getRevision();
    const byTenant = new Map(subnets.map((s) => [s.tenantId, s.subnetCidr]));
    const cidrs = new Set(subnets.map((s) => s.subnetCidr));
    const desiredPeers = peers.map((p) => {
      const tenantSubnet = byTenant.get(p.tenantId || DEFAULT_TENANT_ID) || subnetFromIp(p.allocatedIp);
      cidrs.add(tenantSubnet); // garantiza que cada IP caiga en una subred declarada
      return {
        id: p.id,
        publicKey: p.publicKey,
        allocatedIp: p.allocatedIp,
        name: p.name,
        encryptedPresharedKey: p.encryptedPresharedKey,
        tenantSubnet,
      };
    });
    return { peers: desiredPeers, tenantSubnets: Array.from(cidrs), revision };
  }

  /** Tras un apply v2 exitoso: ACK de estado (peers → applied + revisión). */
  private async ackAppliedState(
    _result: HostApplyResult,
    snapshot: AppliedStateSnapshot,
  ): Promise<void> {
    if (!isWireguardMultitenantEnabled()) return;
    await this.repo.ackAppliedSnapshot(snapshot.revision, snapshot.digest, snapshot.peerIds);
  }

  /**
   * Sincroniza peers activos → host wg0 (await). Devuelve el resultado del
   * apply (ya NO lo traga como éxito): el llamador ajusta el apply_state del
   * peer según el ACK. No lanza; el flujo de negocio sigue vivo.
   */
  private async syncHostAfterMutation(reason: string): Promise<HostApplyResult> {
    try {
      const result = await flushHostPeerSync();
      if (!result.ok && !result.skipped) {
        logger.warn('WireGuard: host-apply no aplicado tras mutación', {
          reason,
          detail: result.detail,
        });
      }
      return result;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn('WireGuard: host-apply error tras mutación', { reason, error: detail });
      return { ok: false, detail };
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
      ...(isWireguardMultitenantEnabled() ? { applyState: rec.applyState || 'applied' } : {}),
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
  // Multi-tenant: el servidor WG es un SINGLETON GLOBAL de plataforma —
  // visible a todos los tenants (sin filtro). Con el flag apagado se mantiene
  // el filtrado por tenant actual.
  async listServers(tenantId?: string): Promise<WireguardServerView[]> {
    const multi = isWireguardMultitenantEnabled();
    const servers = await this.repo.listServers(multi ? undefined : tenantId);
    const peers = await this.repo.listPeers(!multi && tenantId ? { tenantId } : undefined);
    return servers.map((s) => this.toServerView(s, peers.filter((p) => p.serverId === s.id && p.status === 'active').length));
  }

  /** Servidor WireGuard por defecto (global en multi-tenant, del tenant si no). */
  async getDefaultServer(tenantId?: string): Promise<WireguardServerView | null> {
    const multi = isWireguardMultitenantEnabled();
    const rec = await this.repo.getDefaultServer(multi ? undefined : tenantId);
    if (!rec) return null;
    const peers = await this.repo.listPeers({ serverId: rec.id, status: 'active', ...(multi ? {} : { tenantId }) });
    return this.toServerView(rec, peers.length);
  }

  /**
   * Vista previa de la siguiente IP libre (sin reservar). Multi-tenant: la
   * calcula dentro del bloque /24 del tenant de sesión. Con el flag apagado
   * usa el pool del servidor (comportamiento actual).
   */
  async previewNextIp(serverId?: string, tenantId?: string): Promise<{ ip: string; serverId: string; serverName: string; preview: true }> {
    const multi = isWireguardMultitenantEnabled();
    const rec = serverId
      ? await this.repo.getServer(serverId, multi ? undefined : tenantId)
      : await this.repo.getDefaultServer(multi ? undefined : tenantId);
    if (!rec) throw new NotFoundError('No hay servidor WireGuard configurado.');
    const allocations = await this.repo.listAllocations(rec.id);

    if (!multi) {
      const ip = nextFreeIp(
        allocations.map((a) => ({ ip: a.ip, status: a.status })),
        rec.vpnCidr,
        [rec.serverVpnIp],
      );
      if (!ip) throw new Error('WireGuard IP pool exhausted');
      return { ip, serverId: rec.id, serverName: rec.name, preview: true };
    }

    // Bloque /24 del tenant (o el próximo bloque a asignar si aún no tiene).
    const tid = tenantId || DEFAULT_TENANT_ID;
    const cidr = await this.tenantBlockCidr(tid);
    const reserved = cidr.split('/')[0].replace(/\.0$/, '.1');   // 10.70.X.1
    const ip = nextFreeIpInCidr(
      allocations.map((a) => ({ ip: a.ip, status: a.status })),
      cidr,
      [reserved],
    );
    if (!ip) throw new Error('WireGuard block exhausted');
    return { ip, serverId: rec.id, serverName: rec.name, preview: true };
  }

  /** /24 del tenant: el existente, o el próximo bloque secuencial libre. */
  private async tenantBlockCidr(tenantId: string): Promise<string> {
    const own = (await this.repo.listSubnets(tenantId))[0];
    if (own) return own.subnetCidr;
    const all = await this.repo.listSubnets();
    const nextIndex = all.reduce((m, s) => Math.max(m, s.subnetIndex), -1) + 1;
    return `10.70.${nextIndex}.0/24`;
  }

  /**
   * Bloque /24 del tenant + uso de cuota (para el WireGuard Manager y el wizard).
   * `used` cuenta sólo peers equipment activos (los person no consumen cuota).
   */
  async getTenantBlock(tenantId?: string): Promise<{
    subnetCidr: string; subnetIndex: number; maxPeers: number; used: number; multiTenant: boolean;
  }> {
    const tid = tenantId || DEFAULT_TENANT_ID;
    const own = (await this.repo.listSubnets(tid))[0];
    const subnetCidr = own ? own.subnetCidr : await this.tenantBlockCidr(tid);
    const subnetIndex = own ? own.subnetIndex : Number(subnetCidr.split('.')[2]);
    const maxPeers = own?.maxPeers ?? 30;
    const peers = await this.repo.listPeers({ tenantId: tid, status: 'active' });
    const used = peers.filter((p) => (p.peerType || 'equipment') === 'equipment').length;
    return { subnetCidr, subnetIndex, maxPeers, used, multiTenant: isWireguardMultitenantEnabled() };
  }

  /**
   * Reintenta el apply de un peer al host (para peers en apply_failed). Reenvía
   * el estado deseado completo; el agente re-aplica idempotente (misma revisión).
   * Devuelve la vista del peer con su apply_state actualizado, o null si no existe.
   */
  async retryPeerApply(peerId: string, tenantId?: string): Promise<WireguardPeerView | null> {
    const peer = await this.repo.getPeer(peerId, tenantId);
    if (!peer) return null;
    if (isWireguardMultitenantEnabled() && peer.applyState !== 'applied') {
      await this.repo.updatePeer(peerId, { applyState: 'pending_apply' });
    }
    const result = await this.syncHostAfterMutation('retryPeerApply');
    if (isWireguardMultitenantEnabled() && !result.skipped && !result.ok) {
      await this.repo.updatePeer(peerId, { applyState: 'apply_failed' });
    }
    const fresh = await this.repo.getPeer(peerId, tenantId);
    return fresh ? this.toPeerView(fresh) : null;
  }

  async createServer(input: CreateServerInput): Promise<ServerCreatedOnce> {
    const tenantId = input.tenantId || 'tenant-default';
    // El schema garantiza un único default global: desmarcarlo sin scope de tenant.
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
      tenantId,
      status: 'active', createdAt: nowIso(), updatedAt: nowIso(),
    };
    await this.repo.createServer(rec);
    logger.info('WireGuard: servidor creado', { serverId: id, name: rec.name, isDefault: rec.isDefault, tenantId });
    return { server: this.toServerView(rec, 0), serverPrivateKey: kp.privateKey };
  }

  /** Busca un servidor por ID y devuelve su vista, o null si no existe. */
  async findServer(id: string, tenantId?: string): Promise<WireguardServerView | null> {
    const multi = isWireguardMultitenantEnabled();
    const rec = await this.repo.getServer(id, multi ? undefined : tenantId);
    if (!rec) return null;
    const peers = await this.repo.listPeers({ serverId: rec.id, status: 'active', ...(multi ? {} : { tenantId }) });
    return this.toServerView(rec, peers.length);
  }

  // ── peers ─────────────────────────────────────────────────────────────
  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string; tenantId?: string }): Promise<WireguardPeerView[]> {
    return (await this.repo.listPeers(filter)).map((p) => this.toPeerView(p));
  }

  async createPeer(input: CreatePeerInput, actorId?: string): Promise<PeerCreatedOnce> {
    const multi = isWireguardMultitenantEnabled();
    const tenantId = input.tenantId || DEFAULT_TENANT_ID;
    // Server global en multi-tenant (singleton de plataforma); por tenant si no.
    const server = await this.repo.getServer(input.serverId, multi ? undefined : tenantId);
    if (!server) throw new NotFoundError(`Servidor WireGuard '${input.serverId}' no encontrado.`);

    if (multi) return this.createPeerMultiTenant(server, input, tenantId, actorId);

    // ── Ruta actual (flag apagado): IPAM por nextFreeIp, peer 'applied' ──
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
      peerType: 'equipment',
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
        tenantId,
      });
    } else {
      const allocId = await this.repo.nextId('alloc');
      await this.repo.createAllocation({
        id: allocId,
        serverId: server.id,
        ip,
        peerId: id,
        tenantId,
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

  /**
   * Alta multi-tenant (flag encendido): asignación ATÓMICA vía RPC de T1
   * (subred /24 + cuota + IP del bloque), estado pending_apply → applied con el
   * ACK de revisión del agente, y gate de capacidad para altas fuera del bloque 0.
   */
  private async createPeerMultiTenant(
    server: WireguardServerRecord,
    input: CreatePeerInput,
    tenantId: string,
    actorId?: string,
  ): Promise<PeerCreatedOnce> {
    // Gate de capacidad (fail-closed) para altas fuera del bloque 0 (infra).
    if (tenantId !== DEFAULT_TENANT_ID) {
      const cap = await checkHostCapacity();
      if (!cap.ok) {
        throw new BadRequestError(
          'El agente WireGuard del host no acredita capacidad multi-tenant ' +
            '(schemaVersion≥2 + firewall activo). Alta bloqueada (fail-closed).',
          'WIREGUARD_HOST_NOT_READY',
        );
      }
    }

    const kp = generateWgKeyPair();
    const psk = generatePresharedKey();
    const peerId = await this.repo.nextId('peer');
    const allocId = await this.repo.nextId('alloc');

    let alloc;
    try {
      alloc = await this.repo.allocatePeer({
        tenantId, serverId: server.id, peerId, allocId,
        name: input.name, publicKey: kp.publicKey, routerId: input.routerId,
        encryptedPrivateKey: encryptSecret(kp.privateKey),
        encryptedPresharedKey: encryptSecret(psk),
        encryptionVersion: ENCRYPTION_VERSION,
        allowedCidr: peerAllowedCidr(server, input.allowedCidr),
        peerType: 'equipment', createdBy: actorId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/quota_exceeded/.test(msg)) {
        const max = (await this.repo.listSubnets(tenantId))[0]?.maxPeers ?? 30;
        throw new BadRequestError(
          `Límite de ${max} equipos del plan alcanzado. Contacta a soporte para ampliar tu plan.`,
          'WIREGUARD_QUOTA_EXCEEDED',
        );
      }
      if (/block_exhausted|subnet_pool_exhausted/.test(msg)) {
        throw new BadRequestError(
          'No hay direcciones IP disponibles en el bloque del WISP.',
          'WIREGUARD_BLOCK_EXHAUSTED',
        );
      }
      throw err;
    }

    // El RPC ya insertó pending_apply dentro de la misma transacción que IPAM.
    // Bump ANTES del flush: la mutación y el reconcile envían revisión coherente.
    await this.repo.bumpRevision();
    const result = await this.syncHostAfterMutation('createPeer');

    let finalApply: ApplyState = 'pending_apply';
    if (result.ok && !result.skipped) {
      finalApply = 'applied';                       // ackAppliedState ya lo persistió
    } else if (!result.skipped) {
      finalApply = 'apply_failed';                  // el POST falló; visible en UI
      await this.repo.updatePeer(peerId, { applyState: 'apply_failed' });
    }

    logger.info('WireGuard: peer creado (multi-tenant)', {
      peerId, serverId: server.id, ip: alloc.allocation.ip, tenantId, applyState: finalApply,
    });
    return this.peerOnce(server, { ...alloc.peer, applyState: finalApply }, kp.privateKey, psk);
  }

  async rotatePeer(
    peerId: string,
    actorId?: string,
    reason?: string,
    tenantId?: string,
  ): Promise<PeerCreatedOnce | null> {
    const multi = isWireguardMultitenantEnabled();
    const peer = await this.repo.getPeer(peerId, tenantId);
    if (!peer || peer.status !== 'active') return null;
    // Server global en multi-tenant (el peer del tenant apunta al singleton).
    const server = await this.repo.getServer(peer.serverId, multi ? undefined : tenantId);
    if (!server) return null;

    const kp = generateWgKeyPair();
    const psk = generatePresharedKey();
    const oldPub = peer.publicKey;
    const updated = await this.repo.updatePeer(peerId, {
      publicKey: kp.publicKey,
      encryptedPrivateKey: encryptSecret(kp.privateKey),
      encryptedPresharedKey: encryptSecret(psk),
      lastRotatedAt: nowIso(),
      ...(multi ? { applyState: 'pending_apply' as ApplyState } : {}),
    });
    const rotId = await this.repo.nextId('rotation');
    await this.repo.recordRotation({ id: rotId, peerId, tenantId: peer.tenantId, oldPublicKey: oldPub, newPublicKey: kp.publicKey, reason, actorId, createdAt: nowIso() });
    if (multi) await this.repo.bumpRevision();
    logger.info('WireGuard: peer rotado', { peerId, serverId: server.id });
    // Full reconcile: quita pubkey vieja y aplica la nueva (evita peers huérfanos).
    const result = await this.syncHostAfterMutation('rotatePeer');
    if (multi && !result.skipped && !result.ok) {
      await this.repo.updatePeer(peerId, { applyState: 'apply_failed' });
      if (updated) updated.applyState = 'apply_failed';
    } else if (multi && result.ok && !result.skipped && updated) {
      updated.applyState = 'applied';
    }
    return this.peerOnce(server, updated!, kp.privateKey, psk);
  }

  async revokePeer(peerId: string, tenantId?: string): Promise<boolean> {
    const multi = isWireguardMultitenantEnabled();
    const peer = await this.repo.getPeer(peerId, tenantId);
    if (!peer) return false;
    await this.repo.updatePeer(peerId, { status: 'revoked', revokedAt: nowIso() });
    // Liberar la IP para reutilización.
    const allocations = await this.repo.listAllocations(peer.serverId);
    const alloc = allocations.find((a) => a.ip === peer.allocatedIp && a.status === 'allocated');
    if (alloc) await this.repo.updateAllocation(alloc.id, { status: 'released', releasedAt: nowIso() });
    if (multi) await this.repo.bumpRevision();
    logger.info('WireGuard: peer revocado', { peerId });
    // Full reconcile: el peer revocado sale del estado deseado del host.
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
  async getPeerConfigForRouter(
    routerId: string,
    serverId: string,
    actorId?: string,
    tenantId?: string,
  ): Promise<PeerCreatedOnce> {
    const existing = (await this.repo.listPeers({
      serverId, routerId, status: 'active', tenantId,
    }))[0];
    if (!existing) {
      return this.createPeer(
        { serverId, name: `router-${routerId}`, routerId, tenantId },
        actorId,
      );
    }
    const multi = isWireguardMultitenantEnabled();
    const server = await this.repo.getServer(serverId, multi ? undefined : tenantId);
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
