import {
  ProvisioningAction,
  ProvisioningAuditEntry,
  ProvisioningStatus,
  ProvisioningSummary,
} from './types';

const ACTIONS: ProvisioningAction[] = [];
const AUDIT: ProvisioningAuditEntry[] = [];
let actionCounter = 0;
let auditCounter = 0;

const nextActionId = (): string => {
  actionCounter += 1;
  return `prov-${actionCounter}`;
};

const nextAuditId = (): string => {
  auditCounter += 1;
  return `prova-${auditCounter}`;
};

const count = (status: ProvisioningStatus): number => ACTIONS.filter((item) => item.status === status).length;

export const provisioningStore = {
  create(action: ProvisioningAction): ProvisioningAction {
    ACTIONS.unshift(action);
    return action;
  },

  list(): ProvisioningAction[] {
    return [...ACTIONS];
  },

  getById(id: string): ProvisioningAction | undefined {
    return ACTIONS.find((item) => item.id === id);
  },

  update(id: string, patch: Partial<ProvisioningAction>): ProvisioningAction | undefined {
    const index = ACTIONS.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    ACTIONS[index] = { ...ACTIONS[index], ...patch };
    return ACTIONS[index];
  },

  appendAudit(entry: ProvisioningAuditEntry): ProvisioningAuditEntry {
    AUDIT.push(entry);
    return entry;
  },

  listAudit(actionId: string): ProvisioningAuditEntry[] {
    return AUDIT.filter((item) => item.actionId === actionId);
  },

  summary(): ProvisioningSummary {
    return {
      total: ACTIONS.length,
      pending: count('PENDING'),
      validated: count('VALIDATED'),
      simulated: count('SIMULATED'),
      approved: count('APPROVED'),
      rejected: count('REJECTED'),
      cancelled: count('CANCELLED'),
      dryRun: true,
    };
  },

  nextActionId,
  nextAuditId,

  clearForTests(): void {
    ACTIONS.length = 0;
    AUDIT.length = 0;
    actionCounter = 0;
    auditCounter = 0;
  },
};
