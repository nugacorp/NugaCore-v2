// ====================================================================
// Mappers / validación / dry-run Safe Command Queue (FAST-1).
//
// Funciones puras. Generan una previsualización DESCRIPTIVA (no ejecutable)
// de lo que un comando HARÍA, junto con nivel de riesgo y advertencias de
// seguridad. Nunca producen scripts RouterOS reales ni ejecutan nada.
// ====================================================================

import { BadRequestError, ConflictError } from '../../common/errors';
import { sanitizeSensitiveData, sanitizeText } from '../../common/security/sanitize-sensitive-data';
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

const nowIso = (): string => new Date().toISOString();

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

// Nivel de riesgo por tipo de comando.
const RISK_BY_TYPE: Record<SafeCommandType, RiskLevel> = {
  SUSPEND_CUSTOMER: 'high',
  RESTORE_CUSTOMER: 'medium',
  UPDATE_QUEUE: 'medium',
  UPDATE_PLAN: 'medium',
  ADD_ADDRESS_LIST: 'medium',
  REMOVE_ADDRESS_LIST: 'medium',
  REBOOT_CPE: 'high',
};

// Previsualización DESCRIPTIVA (dry-run). No es sintaxis RouterOS ejecutable.
const PREVIEW_BY_TYPE: Record<SafeCommandType, (targetId: string) => string[]> = {
  SUSPEND_CUSTOMER: (t) => [`[dry-run] Marcaría al cliente ${t} en address-list de suspensión (no se ejecuta).`],
  RESTORE_CUSTOMER: (t) => [`[dry-run] Quitaría al cliente ${t} de la address-list de suspensión (no se ejecuta).`],
  UPDATE_QUEUE: (t) => [`[dry-run] Ajustaría la cola/ancho de banda del target ${t} (no se ejecuta).`],
  UPDATE_PLAN: (t) => [`[dry-run] Aplicaría el nuevo plan al target ${t} (no se ejecuta).`],
  ADD_ADDRESS_LIST: (t) => [`[dry-run] Agregaría ${t} a una address-list (no se ejecuta).`],
  REMOVE_ADDRESS_LIST: (t) => [`[dry-run] Quitaría ${t} de una address-list (no se ejecuta).`],
  REBOOT_CPE: (t) => [`[dry-run] Reiniciaría el CPE ${t} (no se ejecuta).`],
};

/** Genera la previsualización dry-run (comandos descriptivos, riesgo, warnings). */
export const buildDryRunPreview = (
  commandType: SafeCommandType,
  targetId: string,
): { simulatedCommands: string[]; riskLevel: RiskLevel; safetyWarnings: string[] } => {
  const riskLevel = RISK_BY_TYPE[commandType];
  const safetyWarnings = [
    'Dry-run: ningún comando se ejecuta en routers reales (wouldExecute=false).',
  ];
  if (riskLevel === 'high') {
    safetyWarnings.push('Acción de alto impacto: requiere aprobación humana antes de cualquier ejecución futura.');
  }
  return { simulatedCommands: PREVIEW_BY_TYPE[commandType](targetId), riskLevel, safetyWarnings };
};

/** Construye un comando nuevo (status PENDING) con campos libres saneados. */
export const buildSafeCommand = (
  input: CreateSafeCommandInput,
  id: string,
  createdBy: string,
): SafeCommand => {
  const commandType = normalizeCommandType(input.commandType);
  const targetId = sanitizeText(requireString(input.targetId, 'targetId'));
  const description = sanitizeText(requireString(input.description, 'description'));
  const payload = sanitizeSensitiveData(normalizePayload(input.payload));
  const preview = buildDryRunPreview(commandType, targetId);

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
  // Saneo central: ningún detalle de auditoría debe filtrar secretos/scripts.
  details: sanitizeText(details),
});

// ── Máquina de estados (dry-run safe) ─────────────────────────────────
// No existe transición a EXECUTED/RUNNING/COMPLETED. Aprobar exige simular antes.
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

/** Valida la transición y devuelve el estado resultante; lanza 409 si es inválida. */
export const resolveTransition = (current: SafeCommandStatus, event: TransitionEvent): SafeCommandStatus => {
  if (!ALLOWED_FROM[event].includes(current)) {
    throw new ConflictError(
      `Transición inválida: no se puede ${event} un comando en estado ${current}.`,
      'INVALID_TRANSITION',
    );
  }
  return RESULTING_STATUS[event];
};
