// ====================================================================
// FAST-1 — Safe Command Queue (Dry-Run) — contratos del dominio.
//
// Cola SEGURA de comandos. SOLO dry-run: NUNCA ejecuta RouterOS, NUNCA toca
// routers reales, NO hay worker ni shell. No existen estados EXECUTED/RUNNING/
// COMPLETED ni endpoint /execute. Todo vive en memoria.
// ====================================================================

export const SAFE_COMMAND_STATUSES = [
  'PENDING',
  'VALIDATED',
  'SIMULATED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type SafeCommandStatus = (typeof SAFE_COMMAND_STATUSES)[number];

export const SAFE_COMMAND_TYPES = [
  'SUSPEND_CUSTOMER',
  'RESTORE_CUSTOMER',
  'UPDATE_QUEUE',
  'UPDATE_PLAN',
  'ADD_ADDRESS_LIST',
  'REMOVE_ADDRESS_LIST',
  'REBOOT_CPE',
] as const;
export type SafeCommandType = (typeof SAFE_COMMAND_TYPES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const LOCKOUT_RISKS = ['none', 'possible', 'blocked'] as const;
export type LockoutRisk = (typeof LOCKOUT_RISKS)[number];

export const SAFE_COMMAND_EVENTS = [
  'CREATED',
  'VALIDATED',
  'SIMULATED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type SafeCommandEvent = (typeof SAFE_COMMAND_EVENTS)[number];

/**
 * Comando en cola segura. `dryRun` es siempre true y `wouldExecute` siempre
 * false en FAST-1: no hay ejecución real ni estado EXECUTED.
 */
export interface SafeCommand {
  id: string;
  createdAt: string;
  createdBy: string;
  commandType: SafeCommandType;
  targetId: string;
  description: string;
  payload: Record<string, unknown>;
  status: SafeCommandStatus;
  dryRun: boolean; // siempre true
  wouldExecute: boolean; // siempre false
  riskLevel: RiskLevel;
  simulatedCommands: string[]; // previsualización descriptiva, NO ejecutable
  plannedRouterOsCommands: string[]; // plan técnico para análisis lockout (no se ejecuta)
  lockoutRisk: LockoutRisk;
  lockoutBlocked: boolean;
  safetyWarnings: string[];
  validatedBy?: string;
  validatedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
}

export interface SafeCommandAudit {
  id: string;
  commandId: string;
  timestamp: string;
  actor: string;
  event: SafeCommandEvent;
  details: string;
}

export interface SafeCommandDetail {
  command: SafeCommand;
  audit: SafeCommandAudit[];
}

export interface CreateSafeCommandInput {
  commandType?: unknown;
  targetId?: unknown;
  description?: unknown;
  payload?: unknown;
  notes?: unknown;
}
