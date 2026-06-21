// ====================================================================
// Mappers / validación Manual Safe Mode.
//
// Funciones puras: normalizan la entrada de creación, construyen registros
// de auditoría y validan transiciones de estado. No ejecutan nada.
// ====================================================================

import { BadRequestError, ConflictError } from '../../common/errors';
import { sanitizeSensitiveData, sanitizeText } from '../../common/security/sanitize-sensitive-data';
import {
  CreateSafeActionInput,
  EXECUTION_MODES,
  ExecutionMode,
  SafeAction,
  SafeActionAudit,
  SafeActionEvent,
  SafeActionStatus,
} from './types';

const nowIso = (): string => new Date().toISOString();

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`Campo requerido inválido: ${field}`, 'INVALID_FIELD');
  }
  return value.trim();
};

const normalizeExecutionMode = (value: unknown): ExecutionMode => {
  if (value === undefined || value === null) return 'MANUAL';
  if (typeof value === 'string' && (EXECUTION_MODES as readonly string[]).includes(value)) {
    return value as ExecutionMode;
  }
  throw new BadRequestError(
    `executionMode inválido. Permitidos: ${EXECUTION_MODES.join(', ')}`,
    'INVALID_EXECUTION_MODE',
  );
};

const normalizePayload = (value: unknown): Record<string, unknown> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('payload debe ser un objeto JSON.', 'INVALID_PAYLOAD');
  }
  return value as Record<string, unknown>;
};

/** Construye una SafeAction nueva (status PENDING) desde la entrada del POST. */
export const buildSafeAction = (
  input: CreateSafeActionInput,
  id: string,
  createdBy: string,
): SafeAction => ({
  id,
  createdAt: nowIso(),
  createdBy,
  // Campos libres del cliente: saneados antes de persistir (security hotfix).
  actionType: sanitizeText(requireString(input.actionType, 'actionType')),
  targetType: sanitizeText(requireString(input.targetType, 'targetType')),
  targetId: sanitizeText(requireString(input.targetId, 'targetId')),
  description: sanitizeText(requireString(input.description, 'description')),
  payload: sanitizeSensitiveData(normalizePayload(input.payload)),
  status: 'PENDING',
  executionMode: normalizeExecutionMode(input.executionMode),
  // dryRun por defecto true (postura segura). Solo false si se pasa explícito.
  dryRun: input.dryRun === undefined ? true : Boolean(input.dryRun),
  notes:
    typeof input.notes === 'string' && input.notes.trim() !== ''
      ? sanitizeText(input.notes.trim())
      : undefined,
});

export const buildAudit = (
  id: string,
  actionId: string,
  actor: string,
  event: SafeActionEvent,
  details: string,
): SafeActionAudit => ({
  id,
  actionId,
  timestamp: nowIso(),
  actor,
  event,
  // Saneo central: ningún detalle de auditoría debe filtrar secretos/scripts.
  details: sanitizeText(details),
});

// ── Máquina de estados (read-only safe) ───────────────────────────────
// Desde qué estados es válido cada evento. No existe transición a EXECUTED.
type TransitionEvent = Exclude<SafeActionEvent, 'CREATED'>;

const ALLOWED_FROM: Record<TransitionEvent, SafeActionStatus[]> = {
  APPROVED: ['PENDING'],
  REJECTED: ['PENDING'],
  SIMULATED: ['PENDING'],
  CANCELLED: ['PENDING', 'APPROVED'],
};

const RESULTING_STATUS: Record<TransitionEvent, SafeActionStatus> = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SIMULATED: 'SIMULATED',
  CANCELLED: 'CANCELLED',
};

/** Valida la transición y devuelve el estado resultante; lanza 409 si es inválida. */
export const resolveTransition = (current: SafeActionStatus, event: TransitionEvent): SafeActionStatus => {
  if (!ALLOWED_FROM[event].includes(current)) {
    throw new ConflictError(
      `Transición inválida: no se puede ${event} una acción en estado ${current}.`,
      'INVALID_TRANSITION',
    );
  }
  return RESULTING_STATUS[event];
};
