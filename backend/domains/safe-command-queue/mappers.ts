// ====================================================================
// Mappers / validación / dry-run Safe Command Queue (FAST-1 + PROD-5 prep).
//
// Funciones puras. Generan previsualización y plan RouterOS para análisis
// lockout. Nunca ejecutan comandos ni tocan routers reales.
// ====================================================================

import { BadRequestError, ConflictError } from '../../common/errors';
import { sanitizeSensitiveData, sanitizeText } from '../../common/security/sanitize-sensitive-data';
import { describePlannedCommands, planRouterOsCommands } from './command-planner';
import { analyzeLockoutRisk, readManagementPostureFromEnv } from './lockout-guard';
import {
  CreateSafeCommandInput,
  RiskLevel,
  SAFE_COMMAND_TYPES,
  SafeCommand,
  SafeCommandAudit,
  SafeCommandEvent,
  SafeCommandStatus,
  SafeCommandType,
} from './types';

import { nowIso } from '../../common/time';

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`Campo requerido inválido: ${field}`, 'INVALID_FIELD');
  }
  return value.trim();
};

const normalizeCommandType = (value: unknown): SafeCommandType => {
  if (typeof value === 'string' && (SAFE_COMMAND_TYPES as readonly string[]).includes(value)) {
    return value as SafeCommandType;
  }
  throw new BadRequestError(
    `commandType inválido. Permitidos: ${SAFE_COMMAND_TYPES.join(', ')}`,
    'INVALID_COMMAND_TYPE',
  );
};

const normalizePayload = (value: unknown): Record<string, unknown> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('payload debe ser un objeto JSON.', 'INVALID_PAYLOAD');
  }
  return value as Record<string, unknown>;
};

const RISK_BY_TYPE: Record<SafeCommandType, RiskLevel> = {
  SUSPEND_CUSTOMER: 'high',
  RESTORE_CUSTOMER: 'medium',
  UPDATE_QUEUE: 'medium',
  UPDATE_PLAN: 'medium',
  ADD_ADDRESS_LIST: 'medium',
  REMOVE_ADDRESS_LIST: 'medium',
  REBOOT_CPE: 'high',
};

/** Genera preview dry-run, plan RouterOS y análisis lockout. */
export const buildDryRunPreview = (
  commandType: SafeCommandType,
  targetId: string,
  payload: Record<string, unknown> = {},
): {
  simulatedCommands: string[];
  plannedRouterOsCommands: string[];
  riskLevel: RiskLevel;
  lockoutRisk: SafeCommand['lockoutRisk'];
  lockoutBlocked: boolean;
  safetyWarnings: string[];
} => {
  const riskLevel = RISK_BY_TYPE[commandType];
  const planInput = { commandType, targetId, payload };
  const plannedRouterOsCommands = planRouterOsCommands(planInput);
  const simulatedCommands = describePlannedCommands(planInput);
  const lockout = analyzeLockoutRisk(plannedRouterOsCommands, readManagementPostureFromEnv());

  const safetyWarnings = [
    'Dry-run: ningún comando se ejecuta en routers reales (wouldExecute=false).',
    ...lockout.warnings,
  ];
  if (riskLevel === 'high') {
    safetyWarnings.push('Acción de alto impacto: requiere aprobación humana antes de cualquier ejecución futura.');
  }
  if (lockout.blocked) {
    safetyWarnings.push('LOCKOUT GUARD: el plan podría bloquear acceso administrativo — validación bloqueada.');
  }

  return {
    simulatedCommands,
    plannedRouterOsCommands,
    riskLevel,
    lockoutRisk: lockout.risk,
    lockoutBlocked: lockout.blocked,
    safetyWarnings,
  };
};

export const buildSafeCommand = (
  input: CreateSafeCommandInput,
  id: string,
  createdBy: string,
): SafeCommand => {
  const commandType = normalizeCommandType(input.commandType);
  const targetId = sanitizeText(requireString(input.targetId, 'targetId'));
  const description = sanitizeText(requireString(input.description, 'description'));
  const payload = sanitizeSensitiveData(normalizePayload(input.payload));
  const preview = buildDryRunPreview(commandType, targetId, payload);

  return {
    id,
    createdAt: nowIso(),
    createdBy,
    commandType,
    targetId,
    description,
    payload,
    status: 'PENDING',
    dryRun: true,
    wouldExecute: false,
    riskLevel: preview.riskLevel,
    simulatedCommands: preview.simulatedCommands,
    plannedRouterOsCommands: preview.plannedRouterOsCommands,
    lockoutRisk: preview.lockoutRisk,
    lockoutBlocked: preview.lockoutBlocked,
    safetyWarnings: preview.safetyWarnings,
    notes:
      typeof input.notes === 'string' && input.notes.trim() !== ''
        ? sanitizeText(input.notes.trim())
        : undefined,
  };
};

export const buildAudit = (
  id: string,
  commandId: string,
  actor: string,
  event: SafeCommandEvent,
  details: string,
): SafeCommandAudit => ({
  id,
  commandId,
  timestamp: nowIso(),
  actor,
  event,
  details: sanitizeText(details),
});

type TransitionEvent = Exclude<SafeCommandEvent, 'CREATED'>;

const ALLOWED_FROM: Record<TransitionEvent, SafeCommandStatus[]> = {
  VALIDATED: ['PENDING'],
  SIMULATED: ['VALIDATED'],
  APPROVED: ['SIMULATED'],
  REJECTED: ['PENDING', 'VALIDATED', 'SIMULATED'],
  CANCELLED: ['PENDING', 'VALIDATED', 'SIMULATED', 'APPROVED'],
};

const RESULTING_STATUS: Record<TransitionEvent, SafeCommandStatus> = {
  VALIDATED: 'VALIDATED',
  SIMULATED: 'SIMULATED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

export const resolveTransition = (current: SafeCommandStatus, event: TransitionEvent): SafeCommandStatus => {
  if (!ALLOWED_FROM[event].includes(current)) {
    throw new ConflictError(
      `Transición inválida: no se puede ${event} un comando en estado ${current}.`,
      'INVALID_TRANSITION',
    );
  }
  return RESULTING_STATUS[event];
};

/** Impide avanzar si el lockout guard marcó el plan como bloqueado. */
export const assertNotLockoutBlocked = (command: SafeCommand, action: string): void => {
  if (command.lockoutBlocked) {
    throw new ConflictError(
      `Lockout guard: no se puede ${action} — el plan podría bloquear acceso administrativo (riesgo ${command.lockoutRisk}).`,
      'LOCKOUT_BLOCKED',
    );
  }
};
