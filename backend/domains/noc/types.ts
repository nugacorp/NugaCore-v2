// ====================================================================
// NOC Read-Only Foundation (Fase 4.11.2)
//
// Contratos de salida para el dashboard operativo NOC. Esta fase es
// estrictamente read-only: no ejecuta RouterOS, no escribe en DB de MikroTik,
// no activa worker live y no expone secretos.
// ====================================================================

export type NocRouterStatus = 'online' | 'offline';
export type NocHealthStatus = 'healthy' | 'warning' | 'critical';

export interface NocRouterView {
  id: string;
  name: string;
  status: NocRouterStatus;
  isOnline: boolean;
  connectionType: string;
  managementIp?: string;
  vpnIp?: string;
  lastSeenAt?: string;
  lastHealthCheckAt?: string;
  routerosVersion?: string;
  cpuUsagePct: number;
  memoryUsagePct: number;
  healthStatus: NocHealthStatus;
  // Topología read-only (aditivo, 4.11.3): torre vinculada para la vista NOC.
  towerId?: string;
  towerName?: string;
}

export type NocAlertType =
  | 'router_offline'
  | 'missing_vpn'
  | 'missing_credentials'
  | 'health_stale'
  | 'high_cpu'
  | 'high_memory';

export interface NocDerivedAlert {
  id: string;
  routerId: string;
  routerName: string;
  type: NocAlertType;
  severity: 'critical' | 'warning';
  message: string;
  observedAt?: string;
}

export interface NocSummary {
  totalRouters: number;
  onlineRouters: number;
  offlineRouters: number;
  routersWithVpn: number;
  routersWithCredentials: number;
  pendingProvisioning: number;
  staleRouters: number;
  activeAlerts: number;
  criticalAlerts: number;
  warningAlerts: number;
}
