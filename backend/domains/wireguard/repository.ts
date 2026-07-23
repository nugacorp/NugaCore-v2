// ====================================================================
// WireguardRepository (Fase 4.6.1) — persistencia de servidores/peers/IPAM/
// rotaciones. StoreWireguardRepository (memoria) + SupabaseWireguardRepository.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AllocatePeerInput,
  AllocatePeerResult,
  ENCRYPTION_VERSION,
  WireguardIpAllocation,
  WireguardKeyRotation,
  WireguardPeerRecord,
  WireguardServerRecord,
  WireguardTenantSubnet,
} from './types';
import {
  AllocationRow, PeerRow, RotationRow, ServerRow, TenantSubnetRow,
  allocationToRow, peerToRow, rotationToRow, serverToRow,
  rowToAllocation, rowToPeer, rowToRotation, rowToServer, rowToTenantSubnet,
} from './mappers';
import { nextFreeIpInCidr } from './ipam';

export interface WireguardRepository {
  listServers(tenantId?: string): Promise<WireguardServerRecord[]>;
  getServer(id: string, tenantId?: string): Promise<WireguardServerRecord | null>;
  getDefaultServer(tenantId?: string): Promise<WireguardServerRecord | null>;
  createServer(rec: WireguardServerRecord): Promise<WireguardServerRecord>;
  updateServer(id: string, patch: Partial<WireguardServerRecord>): Promise<WireguardServerRecord | null>;

  listPeers(filter?: { serverId?: string; routerId?: string; status?: string; tenantId?: string }): Promise<WireguardPeerRecord[]>;
  getPeer(id: string, tenantId?: string): Promise<WireguardPeerRecord | null>;
  createPeer(rec: WireguardPeerRecord): Promise<WireguardPeerRecord>;
  updatePeer(id: string, patch: Partial<WireguardPeerRecord>): Promise<WireguardPeerRecord | null>;

  listAllocations(serverId: string): Promise<WireguardIpAllocation[]>;
  createAllocation(rec: WireguardIpAllocation): Promise<WireguardIpAllocation>;
  updateAllocation(id: string, patch: Partial<WireguardIpAllocation>): Promise<void>;

  /**
   * Asignación ATÓMICA de un peer (cierra B-05): en una sola transacción
   * serializada por tenant — upsert de subred (subnet_index=max+1), cuota
   * (equipment activos < max_peers), IP dentro del /24 del tenant (liberadas
   * del bloque primero) e inserción de allocation + peer. Errores tipados por
   * mensaje: quota_exceeded, block_exhausted, subnet_pool_exhausted.
   */
  allocatePeer(input: AllocatePeerInput): Promise<AllocatePeerResult>;
  listSubnets(tenantId?: string): Promise<WireguardTenantSubnet[]>;

  recordRotation(rec: WireguardKeyRotation): Promise<WireguardKeyRotation>;
  listRotations(peerId?: string): Promise<WireguardKeyRotation[]>;

  // ── Revisión monotónica del contrato v2 (singleton global) ──────────────
  /** Revisión deseada actual (para el reconcile: reenvía la misma). */
  getRevision(): Promise<number>;
  /** Incrementa y devuelve la nueva revisión (una por MUTACIÓN). */
  bumpRevision(): Promise<number>;
  /** ACK atómico de la revisión/digest y de los IDs exactos enviados al host. */
  ackAppliedSnapshot(revision: number, digest: string | undefined, peerIds: string[]): Promise<void>;

  nextId(kind: 'server' | 'peer' | 'alloc' | 'rotation'): Promise<string>;
}

// ════════════════════════════════════════════════════════════════════
// Store (memoria)
// ════════════════════════════════════════════════════════════════════
const PREFIX = { server: 'wgs', peer: 'wgp', alloc: 'wgip', rotation: 'wgrot' } as const;

const seedSubnets = (): WireguardTenantSubnet[] => [
  // Bloque 0 = infra (espejo del seed de la migración).
  { tenantId: 'tenant-default', subnetCidr: '10.70.0.0/24', subnetIndex: 0, maxPeers: 30 },
];

export class StoreWireguardRepository implements WireguardRepository {
  SERVERS: WireguardServerRecord[] = [];
  PEERS: WireguardPeerRecord[] = [];
  ALLOCATIONS: WireguardIpAllocation[] = [];
  ROTATIONS: WireguardKeyRotation[] = [];
  SUBNETS: WireguardTenantSubnet[] = seedSubnets();
  // Revisión monotónica del contrato v2 (réplica en memoria del singleton DB).
  private revision = 0;
  private appliedRevision: number | null = null;
  private appliedDigest: string | null = null;
  private seq = { server: 1, peer: 1, alloc: 1, rotation: 1 };
  // Mutex por tenant: réplica del pg_advisory_xact_lock(hash(tenant_id)) para
  // serializar allocatePeer concurrentes del mismo tenant.
  private tenantLocks = new Map<string, Promise<unknown>>();

  private async withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tenantLocks.get(tenantId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    this.tenantLocks.set(tenantId, prev.then(() => gate));
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async nextId(kind: 'server' | 'peer' | 'alloc' | 'rotation') {
    return `${PREFIX[kind]}-${this.seq[kind]++}`;
  }

  async listServers(tenantId?: string) {
    return this.SERVERS.filter((s) => !tenantId || (s.tenantId || 'tenant-default') === tenantId);
  }
  async getServer(id: string, tenantId?: string) {
    const s = this.SERVERS.find((x) => x.id === id) ?? null;
    if (!s || !tenantId) return s;
    return (s.tenantId || 'tenant-default') === tenantId ? s : null;
  }
  async getDefaultServer(tenantId?: string) {
    return this.SERVERS.find((s) =>
      s.isDefault && s.status === 'active'
      && (!tenantId || (s.tenantId || 'tenant-default') === tenantId)) ?? null;
  }
  async createServer(rec: WireguardServerRecord) { this.SERVERS.push(rec); return rec; }
  async updateServer(id: string, patch: Partial<WireguardServerRecord>) {
    const s = this.SERVERS.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
    return s;
  }

  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string; tenantId?: string }) {
    return this.PEERS.filter((p) =>
      (!filter?.serverId || p.serverId === filter.serverId) &&
      (!filter?.routerId || p.routerId === filter.routerId) &&
      (!filter?.status || p.status === filter.status) &&
      (!filter?.tenantId || (p.tenantId || 'tenant-default') === filter.tenantId));
  }
  async getPeer(id: string, tenantId?: string) {
    const p = this.PEERS.find((x) => x.id === id) ?? null;
    if (!p || !tenantId) return p;
    return (p.tenantId || 'tenant-default') === tenantId ? p : null;
  }
  async createPeer(rec: WireguardPeerRecord) { this.PEERS.push(rec); return rec; }
  async updatePeer(id: string, patch: Partial<WireguardPeerRecord>) {
    const p = this.PEERS.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch, { updatedAt: new Date().toISOString() });
    return p;
  }

  async listAllocations(serverId: string) { return this.ALLOCATIONS.filter((a) => a.serverId === serverId); }
  async createAllocation(rec: WireguardIpAllocation) { this.ALLOCATIONS.push(rec); return rec; }
  async updateAllocation(id: string, patch: Partial<WireguardIpAllocation>) {
    const a = this.ALLOCATIONS.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  }

  async listSubnets(tenantId?: string) {
    return this.SUBNETS.filter((s) => !tenantId || s.tenantId === tenantId);
  }

  async allocatePeer(input: AllocatePeerInput): Promise<AllocatePeerResult> {
    return this.withTenantLock(input.tenantId, async () => {
      // 1) Subred del tenant (upsert; subnet_index = max+1).
      let subnet = this.SUBNETS.find((s) => s.tenantId === input.tenantId);
      if (!subnet) {
        const nextIndex = this.SUBNETS.reduce((m, s) => Math.max(m, s.subnetIndex), -1) + 1;
        if (nextIndex > 254) throw new Error('subnet_pool_exhausted');
        subnet = {
          tenantId: input.tenantId,
          subnetCidr: `10.70.${nextIndex}.0/24`,
          subnetIndex: nextIndex,
          maxPeers: 30,
          createdAt: new Date().toISOString(),
        };
        this.SUBNETS.push(subnet);
      }

      // 2) Cuota: solo equipment activos consumen.
      const peerType = input.peerType || 'equipment';
      if (peerType === 'equipment') {
        const active = this.PEERS.filter((p) =>
          (p.tenantId || 'tenant-default') === input.tenantId
          && p.status === 'active'
          && (p.peerType || 'equipment') === 'equipment').length;
        if (active >= subnet.maxPeers) throw new Error('quota_exceeded');
      }

      // 3) IP dentro del /24 (.0/.1/.255 reservadas; liberadas del bloque primero).
      const network = subnet.subnetCidr.split('/')[0];          // 10.70.X.0
      const reservedIp = network.replace(/\.0$/, '.1');         // 10.70.X.1
      const serverAllocs = this.ALLOCATIONS.filter((a) => a.serverId === input.serverId);
      const ip = nextFreeIpInCidr(
        serverAllocs.map((a) => ({ ip: a.ip, status: a.status })),
        subnet.subnetCidr,
        [reservedIp],
      );
      if (!ip) throw new Error('block_exhausted');
      // Red de seguridad (espejo del índice único parcial de IP activa).
      if (this.PEERS.some((p) => p.serverId === input.serverId && p.allocatedIp === ip && p.status === 'active')) {
        throw new Error('ip_conflict');
      }

      // 4) Peer + allocation.
      const now = new Date().toISOString();
      const peer: WireguardPeerRecord = {
        id: input.peerId, serverId: input.serverId, routerId: input.routerId, name: input.name,
        publicKey: input.publicKey, encryptedPrivateKey: input.encryptedPrivateKey,
        encryptedPresharedKey: input.encryptedPresharedKey,
        encryptionVersion: input.encryptionVersion || ENCRYPTION_VERSION,
        allocatedIp: ip, allowedCidr: input.allowedCidr, tenantId: input.tenantId, peerType,
        status: 'active', applyState: 'pending_apply', createdBy: input.createdBy, createdAt: now, updatedAt: now,
      };
      this.PEERS.push(peer);

      const existing = serverAllocs.find((a) => a.ip === ip);
      let allocation: WireguardIpAllocation;
      if (existing) {
        Object.assign(existing, {
          status: 'allocated', peerId: input.peerId, releasedAt: undefined,
          allocatedAt: now, tenantId: input.tenantId,
        });
        allocation = existing;
      } else {
        allocation = {
          id: input.allocId, serverId: input.serverId, ip, peerId: input.peerId,
          tenantId: input.tenantId, status: 'allocated', allocatedAt: now,
        };
        this.ALLOCATIONS.push(allocation);
      }
      return { peer, allocation, subnet };
    });
  }

  async recordRotation(rec: WireguardKeyRotation) { this.ROTATIONS.unshift(rec); return rec; }
  async listRotations(peerId?: string) {
    return peerId ? this.ROTATIONS.filter((r) => r.peerId === peerId) : this.ROTATIONS;
  }

  async getRevision() { return this.revision; }
  async bumpRevision() { this.revision += 1; return this.revision; }
  async ackAppliedSnapshot(revision: number, digest: string | undefined, peerIds: string[]) {
    const desiredRevision = this.revision;
    const currentRevision = this.appliedRevision;
    const currentDigest = this.appliedDigest;
    const acknowledgedDigest = digest ?? null;

    if (revision < desiredRevision) return;
    if (revision > desiredRevision) {
      throw new Error('apply_snapshot_future_revision');
    }

    if (currentRevision !== null) {
      if (revision === currentRevision && acknowledgedDigest !== currentDigest) {
        throw new Error('apply_snapshot_digest_mismatch');
      }
    }

    const ids = new Set(peerIds);
    for (const p of this.PEERS) {
      if (ids.has(p.id) && p.status === 'active') p.applyState = 'applied';
    }

    if (currentRevision === null || revision > currentRevision) {
      this.appliedRevision = revision;
      this.appliedDigest = acknowledgedDigest;
    }
  }

  reset() {
    this.SERVERS = []; this.PEERS = []; this.ALLOCATIONS = []; this.ROTATIONS = [];
    this.SUBNETS = seedSubnets();
    this.tenantLocks = new Map();
    this.revision = 0; this.appliedRevision = null; this.appliedDigest = null;
    this.seq = { server: 1, peer: 1, alloc: 1, rotation: 1 };
  }
}

// ════════════════════════════════════════════════════════════════════
// Supabase
// ════════════════════════════════════════════════════════════════════
export class SupabaseWireguardRepository implements WireguardRepository {
  constructor(private readonly client: SupabaseClient) {}
  private seq = Date.now();

  async nextId(kind: 'server' | 'peer' | 'alloc' | 'rotation') {
    return `${PREFIX[kind]}-${this.seq++}`;
  }

  async listServers(tenantId?: string) {
    let q = this.client.from('wireguard_servers').select('*').order('created_at', { ascending: false });
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data, error } = await q;
    if (error) throw new Error(`listServers: ${error.message}`);
    return (data || []).map((r) => rowToServer(r as ServerRow));
  }
  async getServer(id: string, tenantId?: string) {
    let q = this.client.from('wireguard_servers').select('*').eq('id', id);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data } = await q.maybeSingle();
    return data ? rowToServer(data as ServerRow) : null;
  }
  async getDefaultServer(tenantId?: string) {
    let q = this.client.from('wireguard_servers').select('*').eq('is_default', true).eq('status', 'active');
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data } = await q.maybeSingle();
    return data ? rowToServer(data as ServerRow) : null;
  }
  async createServer(rec: WireguardServerRecord) {
    const { error } = await this.client.from('wireguard_servers').insert(serverToRow(rec));
    if (error) throw new Error(`createServer: ${error.message}`);
    return rec;
  }
  async updateServer(id: string, patch: Partial<WireguardServerRecord>) {
    const row: Record<string, unknown> = {};
    if (patch.isDefault !== undefined) row.is_default = patch.isDefault;
    if (patch.status !== undefined) row.status = patch.status;
    if (Object.keys(row).length) {
      const { error } = await this.client.from('wireguard_servers').update(row).eq('id', id);
      if (error) throw new Error(`updateServer: ${error.message}`);
    }
    return this.getServer(id);
  }

  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string; tenantId?: string }) {
    let q = this.client.from('wireguard_peers').select('*').order('created_at', { ascending: false });
    if (filter?.serverId) q = q.eq('server_id', filter.serverId);
    if (filter?.routerId) q = q.eq('router_id', filter.routerId);
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.tenantId) q = q.eq('tenant_id', filter.tenantId);
    const { data, error } = await q;
    if (error) throw new Error(`listPeers: ${error.message}`);
    return (data || []).map((r) => rowToPeer(r as PeerRow));
  }
  async getPeer(id: string, tenantId?: string) {
    let q = this.client.from('wireguard_peers').select('*').eq('id', id);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data } = await q.maybeSingle();
    return data ? rowToPeer(data as PeerRow) : null;
  }
  async createPeer(rec: WireguardPeerRecord) {
    const { error } = await this.client.from('wireguard_peers').insert(peerToRow(rec));
    if (error) throw new Error(`createPeer: ${error.message}`);
    return rec;
  }
  async updatePeer(id: string, patch: Partial<WireguardPeerRecord>) {
    const current = await this.getPeer(id);
    if (!current) return null;
    const merged = { ...current, ...patch };
    const { error } = await this.client.from('wireguard_peers').update(peerToRow(merged)).eq('id', id);
    if (error) throw new Error(`updatePeer: ${error.message}`);
    return merged;
  }

  async listAllocations(serverId: string) {
    const { data, error } = await this.client.from('wireguard_ip_allocations').select('*').eq('server_id', serverId);
    if (error) throw new Error(`listAllocations: ${error.message}`);
    return (data || []).map((r) => rowToAllocation(r as AllocationRow));
  }
  async createAllocation(rec: WireguardIpAllocation) {
    const { error } = await this.client.from('wireguard_ip_allocations').insert(allocationToRow(rec));
    if (error) throw new Error(`createAllocation: ${error.message}`);
    return rec;
  }
  async updateAllocation(id: string, patch: Partial<WireguardIpAllocation>) {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.peerId !== undefined) row.peer_id = patch.peerId || null;
    if ('releasedAt' in patch) row.released_at = patch.releasedAt || null;
    if (patch.allocatedAt !== undefined) row.allocated_at = patch.allocatedAt;
    if (patch.tenantId !== undefined) row.tenant_id = patch.tenantId;
    if (Object.keys(row).length) {
      const { error } = await this.client.from('wireguard_ip_allocations').update(row).eq('id', id);
      if (error) throw new Error(`updateAllocation: ${error.message}`);
    }
  }

  async recordRotation(rec: WireguardKeyRotation) {
    const { error } = await this.client.from('wireguard_key_rotations').insert(rotationToRow(rec));
    if (error) throw new Error(`recordRotation: ${error.message}`);
    return rec;
  }
  async listRotations(peerId?: string) {
    let q = this.client.from('wireguard_key_rotations').select('*').order('created_at', { ascending: false });
    if (peerId) q = q.eq('peer_id', peerId);
    const { data, error } = await q;
    if (error) throw new Error(`listRotations: ${error.message}`);
    return (data || []).map((r) => rowToRotation(r as RotationRow));
  }

  async listSubnets(tenantId?: string) {
    let q = this.client.from('wireguard_tenant_subnets').select('*').order('subnet_index', { ascending: true });
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data, error } = await q;
    if (error) throw new Error(`listSubnets: ${error.message}`);
    return (data || []).map((r) => rowToTenantSubnet(r as TenantSubnetRow));
  }

  async getRevision() {
    const { data, error } = await this.client
      .from('wireguard_apply_state').select('revision').eq('id', 'global').maybeSingle();
    if (error) throw new Error(`getRevision: ${error.message}`);
    return Number((data as { revision?: number } | null)?.revision ?? 0);
  }
  async bumpRevision() {
    const { data, error } = await this.client.rpc('wg_bump_revision');
    if (error) throw new Error(`bumpRevision: ${error.message}`);
    return Number(data);
  }
  async ackAppliedSnapshot(revision: number, digest: string | undefined, peerIds: string[]) {
    const { error } = await this.client.rpc('wg_ack_applied_snapshot', {
      p_revision: revision,
      p_digest: digest ?? null,
      p_peer_ids: peerIds,
    });
    if (error) throw new Error(`ackAppliedSnapshot: ${error.message}`);
  }

  async allocatePeer(input: AllocatePeerInput): Promise<AllocatePeerResult> {
    // Delega la asignación atómica al RPC transaccional wg_allocate_peer.
    const payload = {
      id: input.peerId,
      allocId: input.allocId,
      name: input.name,
      publicKey: input.publicKey,
      routerId: input.routerId ?? null,
      encryptedPrivateKey: input.encryptedPrivateKey ?? null,
      encryptedPresharedKey: input.encryptedPresharedKey ?? null,
      encryptionVersion: input.encryptionVersion ?? ENCRYPTION_VERSION,
      allowedCidr: input.allowedCidr ?? null,
      peerType: input.peerType ?? 'equipment',
      createdBy: input.createdBy ?? null,
    };
    const { data, error } = await this.client.rpc('wg_allocate_peer', {
      p_tenant_id: input.tenantId,
      p_server_id: input.serverId,
      p_peer: payload,
    });
    if (error) throw new Error(error.message);   // quota_exceeded / block_exhausted / ...
    const res = data as {
      peerId: string; allocId: string; allocatedIp: string;
      subnetCidr: string; subnetIndex: number; maxPeers: number;
    };
    const now = new Date().toISOString();
    const peer: WireguardPeerRecord = {
      id: res.peerId, serverId: input.serverId, routerId: input.routerId, name: input.name,
      publicKey: input.publicKey, encryptedPrivateKey: input.encryptedPrivateKey,
      encryptedPresharedKey: input.encryptedPresharedKey,
      encryptionVersion: input.encryptionVersion || ENCRYPTION_VERSION,
      allocatedIp: res.allocatedIp, allowedCidr: input.allowedCidr, tenantId: input.tenantId,
      peerType: input.peerType || 'equipment', status: 'active', applyState: 'pending_apply', createdBy: input.createdBy,
      createdAt: now, updatedAt: now,
    };
    const allocation: WireguardIpAllocation = {
      id: res.allocId, serverId: input.serverId, ip: res.allocatedIp, peerId: res.peerId,
      tenantId: input.tenantId, status: 'allocated', allocatedAt: now,
    };
    const subnet: WireguardTenantSubnet = {
      tenantId: input.tenantId, subnetCidr: res.subnetCidr,
      subnetIndex: res.subnetIndex, maxPeers: res.maxPeers,
    };
    return { peer, allocation, subnet };
  }
}

// Re-export para tests
export type { ServerRow, PeerRow, AllocationRow, RotationRow, TenantSubnetRow };
