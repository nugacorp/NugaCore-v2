import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors';
import { sanitizeText } from '../../common/security/sanitize-sensitive-data';
import { provisioningStore } from './store';
import {
  CreateProvisioningActionInput,
  PROVISIONING_ACTION_TYPES,
  PROVISIONING_DECISION_SOURCES,
  ProvisioningAction,
  ProvisioningDecisionSource,
  ProvisioningActionDetail,
  ProvisioningActionType,
  ProvisioningPlanStep,
  ProvisioningStatus,
  ProvisioningSummary,
} from './types';

const nowIso = (): string => new Date().toISOString();

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestError(`Campo requerido invalido: ${field}`, 'INVALID_FIELD');
  }
  return sanitizeText(value.trim());
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? sanitizeText(value.trim()) : undefined;

const normalizeActionType = (value: unknown): ProvisioningActionType => {
  if (typeof value === 'string' && (PROVISIONING_ACTION_TYPES as readonly string[]).includes(value)) {
    return value as ProvisioningActionType;
  }
  throw new BadRequestError(`actionType invalido. Permitidos: ${PROVISIONING_ACTION_TYPES.join(', ')}`, 'INVALID_ACTION_TYPE');
};

const normalizeDecisionSource = (value: unknown): ProvisioningDecisionSource => {
  if (typeof value === 'string' && (PROVISIONING_DECISION_SOURCES as readonly string[]).includes(value)) {
    return value as ProvisioningDecisionSource;
  }
  return 'Manual';
};

const plan = (items: string[]): ProvisioningPlanStep[] =>
  items.map((description, index) => ({ id: `step-${index + 1}`, description }));

export const buildExecutionPlan = (
  actionType: ProvisioningActionType,
  customerId: string,
  targetPlanName?: string,
): ProvisioningPlanStep[] => {
  switch (actionType) {
    case 'SUSPEND_CUSTOMER':
      return plan([
        `Marcar cliente ${customerId} con serviceStatus=SUSPENSION_PENDING.`,
        'Marcar billing hold administrativo.',
        'Generar tarea futura de suspension para revision operativa.',
      ]);
    case 'REACTIVATE_CUSTOMER':
      return plan([
        `Validar que cliente ${customerId} no tenga bloqueo financiero activo.`,
        'Marcar serviceStatus=REACTIVATION_PENDING.',
        'Generar tarea futura de reactivacion para revision operativa.',
      ]);
    case 'CHANGE_PLAN':
      return plan([
        `Validar plan destino${targetPlanName ? `: ${targetPlanName}` : ''}.`,
        'Recalcular MRR proyectado.',
        'Generar tarea futura RouterOS descriptiva para cambio de ancho de banda.',
      ]);
    case 'CREATE_CUSTOMER':
      return plan([
        'Validar IP disponible.',
        'Validar equipo asignable.',
        'Validar cobertura y zona de instalacion.',
      ]);
    case 'CANCEL_CUSTOMER':
      return plan([
        `Marcar cliente ${customerId} como baja pendiente.`,
        'Registrar cierre administrativo y cobranza final.',
        'Generar tarea futura de retiro o liberacion de recursos.',
      ]);
    default:
      return plan(['Validar accion solicitada.']);
  }
};

const allowedFrom: Record<Exclude<ProvisioningStatus, 'PENDING'>, ProvisioningStatus[]> = {
  VALIDATED: ['PENDING'],
  SIMULATED: ['VALIDATED'],
  APPROVED: ['SIMULATED'],
  REJECTED: ['PENDING', 'VALIDATED', 'SIMULATED'],
  CANCELLED: ['PENDING', 'VALIDATED', 'SIMULATED', 'APPROVED'],
};

const transition = (
  action: ProvisioningAction,
  nextState: Exclude<ProvisioningStatus, 'PENDING'>,
  actor: string,
  patch: Partial<ProvisioningAction> = {},
): ProvisioningAction => {
  if (!allowedFrom[nextState].includes(action.status)) {
    throw new ConflictError(`Transicion invalida: ${action.status} -> ${nextState}`, 'INVALID_TRANSITION');
  }

  const previousState = action.status;
  const updated = provisioningStore.update(action.id, {
    ...patch,
    previousState,
    nextState,
    status: nextState,
    actor,
    updatedAt: nowIso(),
  });
  if (!updated) throw new NotFoundError('Accion de provisioning no encontrada.', 'PROVISIONING_NOT_FOUND');

  provisioningStore.appendAudit({
    id: provisioningStore.nextAuditId(),
    actionId: updated.id,
    actionType: updated.actionType,
    customerId: updated.customerId,
    executionPlan: updated.executionPlan,
    previousState,
    nextState,
    actor,
    createdAt: nowIso(),
    dryRun: true,
  });

  return updated;
};

const requireAction = (id: string): ProvisioningAction => {
  const action = provisioningStore.getById(id);
  if (!action) throw new NotFoundError('Accion de provisioning no encontrada.', 'PROVISIONING_NOT_FOUND');
  return action;
};

export const provisioningService = {
  createAction(input: CreateProvisioningActionInput, actor: string): ProvisioningAction {
    const actionType = normalizeActionType(input.actionType);
    const customerId = requireString(input.customerId, 'customerId');
    const customerName = optionalString(input.customerName);
    const targetPlanId = optionalString(input.targetPlanId);
    const targetPlanName = optionalString(input.targetPlanName);
    const createdAt = nowIso();
    const action: ProvisioningAction = {
      id: provisioningStore.nextActionId(),
      actionType,
      customerId,
      customerName,
      targetPlanId,
      targetPlanName,
      decisionSource: normalizeDecisionSource(input.decisionSource),
      executionPlan: buildExecutionPlan(actionType, customerId, targetPlanName),
      previousState: null,
      nextState: 'PENDING',
      status: 'PENDING',
      actor,
      createdAt,
      updatedAt: createdAt,
      dryRun: true,
      notes: optionalString(input.notes),
    };

    provisioningStore.create(action);
    provisioningStore.appendAudit({
      id: provisioningStore.nextAuditId(),
      actionId: action.id,
      actionType: action.actionType,
      customerId: action.customerId,
      executionPlan: action.executionPlan,
      previousState: null,
      nextState: 'PENDING',
      actor,
      createdAt,
      dryRun: true,
    });
    return action;
  },

  listActions(): ProvisioningAction[] {
    return provisioningStore.list();
  },

  getAction(id: string): ProvisioningActionDetail {
    const action = requireAction(id);
    return { action, audit: provisioningStore.listAudit(id) };
  },

  summary(): ProvisioningSummary {
    return provisioningStore.summary();
  },

  validateAction(id: string, actor: string): ProvisioningAction {
    return transition(requireAction(id), 'VALIDATED', actor);
  },

  simulateAction(id: string, actor: string): ProvisioningAction {
    return transition(requireAction(id), 'SIMULATED', actor, {
      simulationResult: 'Simulacion completada: plan descriptivo calculado sin cambios reales.',
    });
  },

  approveAction(id: string, actor: string): ProvisioningAction {
    return transition(requireAction(id), 'APPROVED', actor);
  },

  rejectAction(id: string, actor: string, reason?: unknown): ProvisioningAction {
    return transition(requireAction(id), 'REJECTED', actor, {
      rejectionReason: optionalString(reason),
    });
  },

  cancelAction(id: string, actor: string): ProvisioningAction {
    return transition(requireAction(id), 'CANCELLED', actor);
  },
};
