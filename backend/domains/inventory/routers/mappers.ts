// ====================================================================
// Mappers del Inventory Read-Only de routers (Fase 4.11.1).
//
// Convierte un `MikrotikRouterRegistryItem` (modelo canónico) a la vista
// saneada `InventoryRouterView`. NUNCA expone secretos: omite
// encrypted_password, username, claves, tokens y scripts.
// ====================================================================

import { MikrotikRouterRegistryItem } from '../../../state/store';
import { InventoryRouterView, RouterProvisioningStatus } from './types';

const resolveProvisioningStatus = (item: MikrotikRouterRegistryItem): RouterProvisioningStatus =>
  item.provisioningStatus ?? item.status ?? 'pending';

export const toInventoryRouterView = (item: MikrotikRouterRegistryItem): InventoryRouterView => ({
  id: item.id,
  name: item.name,
  status: item.isOnline ? 'online' : 'offline',
  isOnline: item.isOnline,
  provisioningStatus: resolveProvisioningStatus(item),
  connectionType: item.connectionType ?? 'sstp',
  // `management_ip` es la IP canónica; cae al espejo legacy `ip_address`.
  managementIp: item.managementIp ?? item.ipAddress,
  vpnIp: item.vpnIp,
  apiPort: item.apiPort,
  apiSslPort: item.apiSslPort ?? 8729,
  routerOsVersion: item.routerOsVersion,
  towerId: item.linkedTowerId,
  hasCredentials: item.hasCredentials ?? Boolean(item.encryptedPassword),
  cpuUsagePct: item.cpuUsagePct,
  memoryUsagePct: item.memoryUsagePct,
  lastSeenAt: item.lastSeenAt,
  lastHealthCheckAt: item.lastHealthCheckAt,
  notes: item.notes,
});
