// ====================================================================
// Repositorio Manual Safe Mode — store en memoria (síncrono).
//
// NO usa Supabase, NO crea tablas, NO crea migraciones. Solo arrays en
// memoria, igual que otros dominios foundation (p.ej. router-enrollment).
// Expone `_reset()` para los tests.
// ====================================================================

import { SafeAction, SafeActionAudit } from './types';

const ACTIONS: SafeAction[] = [];
const AUDITS: SafeActionAudit[] = [];

let actionCounter = 0;
let auditCounter = 0;

const nextActionId = (): string => {
  actionCounter += 1;
  const ids = new Set(ACTIONS.map((a) => a.id));
  let n = actionCounter;
  while (ids.has(`act-${n}`)) n += 1;
  actionCounter = n;
  return `act-${n}`;
};

const nextAuditId = (): string => {
  auditCounter += 1;
  return `aud-${auditCounter}`;
};

export const manualSafeModeRepository = {
  create(action: SafeAction): SafeAction {
    ACTIONS.unshift(action);
    return action;
  },

  list(): SafeAction[] {
    return [...ACTIONS];
  },

  getById(id: string): SafeAction | undefined {
    return ACTIONS.find((a) => a.id === id);
  },

  update(id: string, patch: Partial<SafeAction>): SafeAction | undefined {
    const idx = ACTIONS.findIndex((a) => a.id === id);
    if (idx === -1) return undefined;
    ACTIONS[idx] = { ...ACTIONS[idx], ...patch };
    return ACTIONS[idx];
  },

  appendAudit(entry: SafeActionAudit): SafeActionAudit {
    AUDITS.push(entry);
    return entry;
  },

  listAudits(actionId: string): SafeActionAudit[] {
    return AUDITS.filter((a) => a.actionId === actionId).sort((a, b) =>
      a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : a.timestamp.localeCompare(b.timestamp),
    );
  },

  nextActionId,
  nextAuditId,

  /** Solo para tests: limpia el store. */
  _reset(): void {
    ACTIONS.length = 0;
    AUDITS.length = 0;
    actionCounter = 0;
    auditCounter = 0;
  },
};
