// ====================================================================
// Production gates — única fuente de verdad para dry-run vs live.
//
// NUGACORE_LIVE_MODE=true habilita todos los subsistemas en producción real.
// Cada flag individual puede forzarse aparte (override explícito).
// Por defecto todo queda en dry-run (seguro para dev/tests).
// ====================================================================

const asBool = (value: string | undefined): boolean =>
  (value || 'false').trim().toLowerCase() === 'true';

const gate = (envKey: string, master = false): boolean =>
  asBool(process.env[envKey]) || master;

const masterLive = (): boolean => asBool(process.env.NUGACORE_LIVE_MODE);

export const productionGates = {
  /** Master switch: activa ejecución real en todos los subsistemas. */
  liveMode: masterLive,

  mikrotikWorkerLive: (): boolean =>
    gate('MIKROTIK_WORKER_LIVE', masterLive()),

  /** Ejecuta comandos RouterOS reales (cortes/reactivaciones). Requiere MIKROTIK_WORKER_LIVE. */
  mikrotikWorkerCommit: (): boolean =>
    gate('MIKROTIK_WORKER_COMMIT', masterLive()),

  notificationsLive: (): boolean =>
    gate('NOTIFICATIONS_LIVE', masterLive()),

  automationExecute: (): boolean =>
    gate('AUTOMATION_EXECUTE', masterLive()),

  provisioningExecute: (): boolean =>
    gate('PROVISIONING_EXECUTE', masterLive()),

  paymentsRouterLive: (): boolean =>
    gate('PAYMENTS_ROUTER_LIVE', masterLive()),

  safeCommandQueueLive: (): boolean =>
    gate('SAFE_COMMAND_QUEUE_LIVE', masterLive()),

  serviceStatusLive: (): boolean =>
    gate('SERVICE_STATUS_LIVE', masterLive()),
} as const;

export type ProductionGateKey = keyof typeof productionGates;

/** Vista serializable para API/UI (sin funciones). */
export const productionGatesSnapshot = (): Record<string, boolean> => ({
  liveMode: productionGates.liveMode(),
  mikrotikWorkerLive: productionGates.mikrotikWorkerLive(),
  mikrotikWorkerCommit: productionGates.mikrotikWorkerCommit(),
  notificationsLive: productionGates.notificationsLive(),
  automationExecute: productionGates.automationExecute(),
  provisioningExecute: productionGates.provisioningExecute(),
  paymentsRouterLive: productionGates.paymentsRouterLive(),
  safeCommandQueueLive: productionGates.safeCommandQueueLive(),
  serviceStatusLive: productionGates.serviceStatusLive(),
});

export const isSubsystemDryRun = (key: Exclude<ProductionGateKey, 'liveMode'>): boolean =>
  !productionGates[key]();
