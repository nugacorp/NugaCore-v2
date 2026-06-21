// ====================================================================
// PROD-1 Manual Safe Mode — contratos del dominio.
//
// Esta fase construye la INFRAESTRUCTURA segura para acciones manuales
// futuras. NO ejecuta comandos, NO toca routers, NO escribe en MikroTik,
// NO existe ejecución real. No hay estado EXECUTED. Todo vive en memoria.
// ====================================================================

export const SAFE_ACTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SIMULATED', 'CANCELLED'] as const;
export type SafeActionStatus = (typeof SAFE_ACTION_STATUSES)[number];

export const EXECUTION_MODES = ['MANUAL', 'DRY_RUN', 'FUTURE_AUTOMATION'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const SAFE_ACTION_EVENTS = ['CREATED', 'APPROVED', 'REJECTED', 'SIMULATED', 'CANCELLED'] as const;
export type SafeActionEvent = (typeof SAFE_ACTION_EVENTS)[number];

/**
 * Acción manual segura. `executedAt` queda reservado para fases futuras y
 * NUNCA se setea en PROD-1 (no hay ejecución real ni estado EXECUTED).
 */
export interface SafeAction {
  id: string;
  createdAt: string;
  createdBy: string;
  actionType: string;
  targetType: string;
  targetId: string;
  description: string;
  payload: Record<string, unknown>;
  status: SafeActionStatus;
  approvedBy?: string;
  approvedAt?: string;
  executedAt?: string; // siempre undefined en PROD-1
  executionMode: ExecutionMode;
  dryRun: boolean;
  notes?: string;
}

/** Registro de auditoría inmutable de cada transición. */
export interface SafeActionAudit {
  id: string;
  actionId: string;
  timestamp: string;
  actor: string;
  event: SafeActionEvent;
  details: string;
}

/** Detalle = acción + su historial de auditoría. */
export interface SafeActionDetail {
  action: SafeAction;
  audit: SafeActionAudit[];
}

/** Entrada para crear una acción (payload del POST). */
export interface CreateSafeActionInput {
  actionType?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  description?: unknown;
  payload?: unknown;
  executionMode?: unknown;
  dryRun?: unknown;
  notes?: unknown;
}
