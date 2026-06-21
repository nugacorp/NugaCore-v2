// ====================================================================
// Service Manual Safe Mode (PROD-1).
//
// Orquesta el ciclo de vida de acciones manuales SEGURAS. Cada operación
// registra auditoría. NINGÚN método ejecuta RouterOS, WireGuard, billing,
// suspensión, workers ni shell. simulateAction() solo cambia el estado y
// audita; no ejecuta absolutamente nada.
// ====================================================================

import { NotFoundError } from '../../common/errors';
import { sanitizeText } from '../../common/security/sanitize-sensitive-data';
import { buildAudit, buildSafeAction, resolveTransition } from './mappers';
import { manualSafeModeRepository as repo } from './repository';
import { CreateSafeActionInput, SafeAction, SafeActionDetail, SafeActionEvent } from './types';

const requireAction = (id: string): SafeAction => {
  const action = repo.getById(id);
  if (!action) throw new NotFoundError('Acción manual no encontrada.', 'ACTION_NOT_FOUND');
  return action;
};

const audit = (actionId: string, actor: string, event: SafeActionEvent, details: string): void => {
  repo.appendAudit(buildAudit(repo.nextAuditId(), actionId, actor, event, details));
};

export const manualSafeModeService = {
  createAction(input: CreateSafeActionInput, actor: string): SafeAction {
    const action = buildSafeAction(input, repo.nextActionId(), actor);
    repo.create(action);
    audit(action.id, actor, 'CREATED', `Acción creada (${action.actionType} → ${action.targetType}:${action.targetId}).`);
    return action;
  },

  listActions(): SafeAction[] {
    return repo.list();
  },

  getAction(id: string): SafeActionDetail {
    const action = requireAction(id);
    return { action, audit: repo.listAudits(id) };
  },

  approveAction(id: string, actor: string): SafeAction {
    const action = requireAction(id);
    const status = resolveTransition(action.status, 'APPROVED');
    const updated = repo.update(id, { status, approvedBy: actor, approvedAt: new Date().toISOString() })!;
    audit(id, actor, 'APPROVED', 'Acción aprobada (sin ejecución).');
    return updated;
  },

  rejectAction(id: string, actor: string, reason?: string): SafeAction {
    const action = requireAction(id);
    const status = resolveTransition(action.status, 'REJECTED');
    // El reason es texto libre del cliente: sanearlo antes de persistir/auditar.
    const safeReason = reason && reason.trim() !== '' ? sanitizeText(reason.trim()) : undefined;
    const notes = safeReason ?? action.notes;
    const updated = repo.update(id, { status, notes })!;
    audit(id, actor, 'REJECTED', safeReason ? `Acción rechazada: ${safeReason}` : 'Acción rechazada.');
    return updated;
  },

  // simulateAction NO ejecuta nada. Solo PENDING -> SIMULATED + auditoría.
  simulateAction(id: string, actor: string): SafeAction {
    const action = requireAction(id);
    const status = resolveTransition(action.status, 'SIMULATED');
    const updated = repo.update(id, { status })!;
    audit(id, actor, 'SIMULATED', 'Simulación segura: no se ejecutó ningún comando ni se tocó ningún router.');
    return updated;
  },

  cancelAction(id: string, actor: string): SafeAction {
    const action = requireAction(id);
    const status = resolveTransition(action.status, 'CANCELLED');
    const updated = repo.update(id, { status })!;
    audit(id, actor, 'CANCELLED', 'Acción cancelada.');
    return updated;
  },
};
