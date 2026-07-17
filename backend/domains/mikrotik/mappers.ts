// ====================================================================
// Mappers mikrotik_routers — snake_case DB ↔ MikrotikRouterRegistryItem.
// ====================================================================

import type { MikrotikRouterRegistryItem } from '../../state/store';

export interface MikrotikRouterRow {
  id: string;
  name: string;
  tenant_id?: string | null;
  ip_address: string;
  api_port: number;
  username: string;
  encrypted_password: string;
  is_online: boolean;
  cpu_usage_pct: number;
  memory_usage_pct: number;
  routeros_version: string | null;
  linked_tower_id: string | null;
  last_health_check_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  connection_type?: string | null;
  management_ip?: string | null;
  vpn_ip?: string | null;
  api_ssl_port?: number | null;
  status?: string | null;
  provisioning_status?: string | null;
  has_credentials?: boolean | null;
  last_seen_at?: string | null;
  notes?: string | null;
}

export const rowToRouter = (row: MikrotikRouterRow): MikrotikRouterRegistryItem => ({
  id: row.id,
  name: row.name,
  tenantId: row.tenant_id || 'tenant-default',
  ipAddress: row.ip_address,
  apiPort: Number(row.api_port) || 8728,
  username: row.username,
  encryptedPassword: row.encrypted_password || '',
  isOnline: row.is_online !== false,
  cpuUsagePct: Number(row.cpu_usage_pct) || 0,
  memoryUsagePct: Number(row.memory_usage_pct) || 0,
  routerOsVersion: row.routeros_version || '7.x',
  linkedTowerId: row.linked_tower_id || undefined,
  lastHealthCheckAt: row.last_health_check_at || '',
  connectionType: (row.connection_type as MikrotikRouterRegistryItem['connectionType']) || undefined,
  managementIp: row.management_ip || undefined,
  vpnIp: row.vpn_ip || undefined,
  apiSslPort: row.api_ssl_port != null ? Number(row.api_ssl_port) : undefined,
  provisioningStatus: (row.provisioning_status as MikrotikRouterRegistryItem['provisioningStatus']) || undefined,
  status: (row.status as MikrotikRouterRegistryItem['status']) || undefined,
  hasCredentials: row.has_credentials ?? !!row.encrypted_password,
  notes: row.notes || undefined,
  lastSeenAt: row.last_seen_at || undefined,
  createdAt: row.created_at || undefined,
  updatedAt: row.updated_at || undefined,
});

export const routerToRow = (r: MikrotikRouterRegistryItem): MikrotikRouterRow => ({
  id: r.id,
  name: r.name,
  tenant_id: r.tenantId || 'tenant-default',
  ip_address: r.managementIp || r.ipAddress || r.vpnIp || '',
  api_port: r.apiPort || 8728,
  username: r.username || 'admin',
  encrypted_password: r.encryptedPassword || '',
  is_online: r.isOnline !== false,
  cpu_usage_pct: r.cpuUsagePct || 0,
  memory_usage_pct: r.memoryUsagePct || 0,
  routeros_version: r.routerOsVersion || null,
  linked_tower_id: r.linkedTowerId || null,
  last_health_check_at: r.lastHealthCheckAt || null,
  created_at: r.createdAt || null,
  updated_at: r.updatedAt || new Date().toISOString(),
  connection_type: r.connectionType || 'sstp',
  management_ip: r.managementIp || r.ipAddress || null,
  vpn_ip: r.vpnIp || null,
  api_ssl_port: r.apiSslPort ?? 8729,
  status: r.status || r.provisioningStatus || 'pending',
  provisioning_status: r.provisioningStatus || r.status || 'pending',
  has_credentials: r.hasCredentials ?? !!r.encryptedPassword,
  last_seen_at: r.lastSeenAt || null,
  notes: r.notes || null,
});
