// ====================================================================
// Mappers WireGuard — filas Postgres ↔ records del dominio (Fase 4.6.1).
// ====================================================================

import {
  WireguardIpAllocation,
  WireguardKeyRotation,
  WireguardPeerRecord,
  WireguardServerRecord,
} from './types';

// ── Servidor ─────────────────────────────────────────────────────────
export interface ServerRow {
  id: string; name: string; endpoint_host: string; endpoint_port: number;
  listen_port: number; public_key: string; encrypted_private_key: string;
  encryption_version: string; vpn_cidr: string; server_vpn_ip: string;
  is_default?: boolean;
  tenant_id?: string | null;
  status: WireguardServerRecord['status']; created_at?: string; updated_at?: string;
}

export const rowToServer = (r: ServerRow): WireguardServerRecord => ({
  id: r.id, name: r.name, endpointHost: r.endpoint_host, endpointPort: r.endpoint_port,
  listenPort: r.listen_port, publicKey: r.public_key, encryptedPrivateKey: r.encrypted_private_key,
  encryptionVersion: r.encryption_version, vpnCidr: r.vpn_cidr, serverVpnIp: r.server_vpn_ip,
  isDefault: r.is_default ?? false,
  tenantId: r.tenant_id || 'tenant-default',
  status: r.status, createdAt: r.created_at || new Date().toISOString(), updatedAt: r.updated_at || new Date().toISOString(),
});

export const serverToRow = (s: WireguardServerRecord): Record<string, unknown> => ({
  id: s.id, name: s.name, endpoint_host: s.endpointHost, endpoint_port: s.endpointPort,
  listen_port: s.listenPort, public_key: s.publicKey, encrypted_private_key: s.encryptedPrivateKey,
  encryption_version: s.encryptionVersion, vpn_cidr: s.vpnCidr, server_vpn_ip: s.serverVpnIp,
  is_default: s.isDefault ?? false, tenant_id: s.tenantId || 'tenant-default', status: s.status,
});

// ── Peer ─────────────────────────────────────────────────────────────
export interface PeerRow {
  id: string; server_id: string; router_id: string | null; name: string; public_key: string;
  encrypted_private_key: string | null; encrypted_preshared_key: string | null; encryption_version: string;
  allocated_ip: string; allowed_cidr: string | null; status: WireguardPeerRecord['status'];
  tenant_id?: string | null;
  last_rotated_at: string | null; revoked_at: string | null; created_by: string | null;
  created_at?: string; updated_at?: string;
}

export const rowToPeer = (r: PeerRow): WireguardPeerRecord => ({
  id: r.id, serverId: r.server_id, routerId: r.router_id || undefined, name: r.name, publicKey: r.public_key,
  encryptedPrivateKey: r.encrypted_private_key || undefined, encryptedPresharedKey: r.encrypted_preshared_key || undefined,
  encryptionVersion: r.encryption_version, allocatedIp: r.allocated_ip, allowedCidr: r.allowed_cidr || undefined,
  tenantId: r.tenant_id || 'tenant-default',
  status: r.status, lastRotatedAt: r.last_rotated_at || undefined, revokedAt: r.revoked_at || undefined,
  createdBy: r.created_by || undefined, createdAt: r.created_at || new Date().toISOString(), updatedAt: r.updated_at || new Date().toISOString(),
});

export const peerToRow = (p: WireguardPeerRecord): Record<string, unknown> => ({
  id: p.id, server_id: p.serverId, router_id: p.routerId || null, name: p.name, public_key: p.publicKey,
  encrypted_private_key: p.encryptedPrivateKey || null, encrypted_preshared_key: p.encryptedPresharedKey || null,
  encryption_version: p.encryptionVersion, allocated_ip: p.allocatedIp, allowed_cidr: p.allowedCidr || null,
  tenant_id: p.tenantId || 'tenant-default',
  status: p.status, last_rotated_at: p.lastRotatedAt || null, revoked_at: p.revokedAt || null, created_by: p.createdBy || null,
});

// ── IPAM ─────────────────────────────────────────────────────────────
export interface AllocationRow {
  id: string; server_id: string; ip: string; peer_id: string | null;
  status: WireguardIpAllocation['status']; allocated_at?: string; released_at: string | null;
}
export const rowToAllocation = (r: AllocationRow): WireguardIpAllocation => ({
  id: r.id, serverId: r.server_id, ip: r.ip, peerId: r.peer_id || undefined,
  status: r.status, allocatedAt: r.allocated_at || new Date().toISOString(), releasedAt: r.released_at || undefined,
});
export const allocationToRow = (a: WireguardIpAllocation): Record<string, unknown> => ({
  id: a.id, server_id: a.serverId, ip: a.ip, peer_id: a.peerId || null,
  status: a.status, released_at: a.releasedAt || null,
});

// ── Rotaciones ───────────────────────────────────────────────────────
export interface RotationRow {
  id: string; peer_id: string; old_public_key: string | null; new_public_key: string;
  reason: string | null; actor_id: string | null; created_at?: string;
}
export const rowToRotation = (r: RotationRow): WireguardKeyRotation => ({
  id: r.id, peerId: r.peer_id, oldPublicKey: r.old_public_key || undefined, newPublicKey: r.new_public_key,
  reason: r.reason || undefined, actorId: r.actor_id || undefined, createdAt: r.created_at || new Date().toISOString(),
});
export const rotationToRow = (r: WireguardKeyRotation): Record<string, unknown> => ({
  id: r.id, peer_id: r.peerId, old_public_key: r.oldPublicKey || null, new_public_key: r.newPublicKey,
  reason: r.reason || null, actor_id: r.actorId || null,
});
