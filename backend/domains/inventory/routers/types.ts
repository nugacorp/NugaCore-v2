// ====================================================================
// Inventory Read-Only de routers MikroTik (Fase 4.11.1).
//
// Tipos de la VISTA saneada del inventario de routers, derivada del modelo
// canónico `mikrotik_routers` (DB-1). READ-ONLY: no expone secretos
// (encrypted_password, claves, tokens) ni habilita escritura.
// ====================================================================

export type RouterOnlineStatus = 'online' | 'offline';
export type RouterProvisioningStatus = 'pending' | 'provisioned' | 'connected' | 'error';

/** Vista read-only de un router para el inventario (sin secretos). */
export interface InventoryRouterView {
  id: string;
  name: string;
  /** Estado de conectividad derivado de `is_online`. */
  status: RouterOnlineStatus;
  isOnline: boolean;
  /** Estado de provisioning canónico (`provisioning_status`). */
  provisioningStatus: RouterProvisioningStatus;
  connectionType: string;
  managementIp?: string;
  vpnIp?: string;
  apiPort: number;
  apiSslPort?: number;
  routerOsVersion?: string;
  towerId?: string;
  hasCredentials: boolean;
  cpuUsagePct: number;
  memoryUsagePct: number;
  lastSeenAt?: string;
  lastHealthCheckAt?: string;
  notes?: string;
}

/** Resumen agregado del inventario de routers (calculado en local). */
export interface InventorySummary {
  totalRouters: number;
  onlineRouters: number;
  offlineRouters: number;
  provisionedRouters: number;
  pendingRouters: number;
  routersWithVpn: number;
  routersWithCredentials: number;
  lastSeenCount: number;
}
