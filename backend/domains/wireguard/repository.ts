// ====================================================================
// WireguardRepository (Fase 4.6.1) — persistencia de servidores/peers/IPAM/
// rotaciones. StoreWireguardRepository (memoria) + SupabaseWireguardRepository.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  WireguardIpAllocation,
  WireguardKeyRotation,
  WireguardPeerRecord,
  WireguardServerRecord,
} from './types';
import {
  AllocationRow, PeerRow, RotationRow, ServerRow,
  allocationToRow, peerToRow, rotationToRow, serverToRow,
  rowToAllocation, rowToPeer, rowToRotation, rowToServer,
} from './mappers';

export interface WireguardRepository {
  listServers(): Promise<WireguardServerRecord[]>;
  getServer(id: string): Promise<WireguardServerRecord | null>;
  createServer(rec: WireguardServerRecord): Promise<WireguardServerRecord>;

  listPeers(filter?: { serverId?: string; routerId?: string; status?: string }): Promise<WireguardPeerRecord[]>;
  getPeer(id: string): Promise<WireguardPeerRecord | null>;
  createPeer(rec: WireguardPeerRecord): Promise<WireguardPeerRecord>;
  updatePeer(id: string, patch: Partial<WireguardPeerRecord>): Promise<WireguardPeerRecord | null>;

  listAllocations(serverId: string): Promise<WireguardIpAllocation[]>;
  createAllocation(rec: WireguardIpAllocation): Promise<WireguardIpAllocation>;
  updateAllocation(id: string, patch: Partial<WireguardIpAllocation>): Promise<void>;

  recordRotation(rec: WireguardKeyRotation): Promise<WireguardKeyRotation>;
  listRotations(peerId?: string): Promise<WireguardKeyRotation[]>;

  nextId(kind: 'server' | 'peer' | 'alloc' | 'rotation'): Promise<string>;
}

// ════════════════════════════════════════════════════════════════════
// Store (memoria)
// ════════════════════════════════════════════════════════════════════
const PREFIX = { server: 'wgs', peer: 'wgp', alloc: 'wgip', rotation: 'wgrot' } as const;

export class StoreWireguardRepository implements WireguardRepository {
  SERVERS: WireguardServerRecord[] = [];
  PEERS: WireguardPeerRecord[] = [];
  ALLOCATIONS: WireguardIpAllocation[] = [];
  ROTATIONS: WireguardKeyRotation[] = [];
  private seq = { server: 1, peer: 1, alloc: 1, rotation: 1 };

  async nextId(kind: 'server' | 'peer' | 'alloc' | 'rotation') {
    return `${PREFIX[kind]}-${this.seq[kind]++}`;
  }

  async listServers() { return this.SERVERS; }
  async getServer(id: string) { return this.SERVERS.find((s) => s.id === id) ?? null; }
  async createServer(rec: WireguardServerRecord) { this.SERVERS.push(rec); return rec; }

  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string }) {
    return this.PEERS.filter((p) =>
      (!filter?.serverId || p.serverId === filter.serverId) &&
      (!filter?.routerId || p.routerId === filter.routerId) &&
      (!filter?.status || p.status === filter.status));
  }
  async getPeer(id: string) { return this.PEERS.find((p) => p.id === id) ?? null; }
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

  async recordRotation(rec: WireguardKeyRotation) { this.ROTATIONS.unshift(rec); return rec; }
  async listRotations(peerId?: string) {
    return peerId ? this.ROTATIONS.filter((r) => r.peerId === peerId) : this.ROTATIONS;
  }

  reset() {
    this.SERVERS = []; this.PEERS = []; this.ALLOCATIONS = []; this.ROTATIONS = [];
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

  async listServers() {
    const { data, error } = await this.client.from('wireguard_servers').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(`listServers: ${error.message}`);
    return (data || []).map((r) => rowToServer(r as ServerRow));
  }
  async getServer(id: string) {
    const { data } = await this.client.from('wireguard_servers').select('*').eq('id', id).single();
    return data ? rowToServer(data as ServerRow) : null;
  }
  async createServer(rec: WireguardServerRecord) {
    const { error } = await this.client.from('wireguard_servers').insert(serverToRow(rec));
    if (error) throw new Error(`createServer: ${error.message}`);
    return rec;
  }

  async listPeers(filter?: { serverId?: string; routerId?: string; status?: string }) {
    let q = this.client.from('wireguard_peers').select('*').order('created_at', { ascending: false });
    if (filter?.serverId) q = q.eq('server_id', filter.serverId);
    if (filter?.routerId) q = q.eq('router_id', filter.routerId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`listPeers: ${error.message}`);
    return (data || []).map((r) => rowToPeer(r as PeerRow));
  }
  async getPeer(id: string) {
    const { data } = await this.client.from('wireguard_peers').select('*').eq('id', id).single();
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
    if (patch.releasedAt !== undefined) row.released_at = patch.releasedAt || null;
    if (Object.keys(row).length) await this.client.from('wireguard_ip_allocations').update(row).eq('id', id);
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
}

// Re-export para tests
export type { ServerRow, PeerRow, AllocationRow, RotationRow };
