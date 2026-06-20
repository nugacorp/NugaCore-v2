// ====================================================================
// NOC Real Telemetry (Fase 4.11.3) — contratos de salida READ-ONLY.
//
// Observabilidad derivada de datos internos ya disponibles (routers + torres
// en `backend/state/store.ts`). NO ejecuta RouterOS, NO escribe, NO envía
// notificaciones, NO encola comandos. Sin DB nueva, sin flags peligrosos.
// ====================================================================

/**
 * Resumen de salud agregado para `GET /api/noc/health`.
 *
 * `online/offline` se cuentan por conectividad (`isOnline`); `warning/critical`
 * se cuentan por `healthStatus` derivado (umbrales CPU/RAM y staleness del
 * dominio `noc`). Un router offline cuenta como `offline` y además como
 * `critical` (son dimensiones distintas, pueden solaparse).
 */
export interface NocHealthSummary {
  totalRouters: number;
  onlineRouters: number;
  offlineRouters: number;
  warningRouters: number;
  criticalRouters: number;
}

/** Telemetría agregada por torre para `GET /api/noc/towers`. */
export interface NocTowerTelemetry {
  towerId: string;
  towerName: string;
  totalRouters: number;
  online: number;
  offline: number;
  warning: number;
  critical: number;
}
