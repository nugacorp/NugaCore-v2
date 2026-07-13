export const PROVISIONING_ACTION_TYPES = [
  'SUSPEND_CUSTOMER',
  'REACTIVATE_CUSTOMER',
  'CHANGE_PLAN',
  'CREATE_CUSTOMER',
  'CANCEL_CUSTOMER',
] as const;
export type ProvisioningActionType = (typeof PROVISIONING_ACTION_TYPES)[number];

// Origen de la decision que motiva una accion de provisioning (PROD-8 / FASE L).
// Permite trazar si la propuso el Automation Engine o un dominio/operador.
export const PROVISIONING_DECISION_SOURCES = [
  'Automation',
  'Manual',
  'Billing',
  'CRM',
  'NOC',
  'Inventory',
] as const;
export type ProvisioningDecisionSource = (typeof PROVISIONING_DECISION_SOURCES)[number];

export const PROVISIONING_STATUSES = [
  'PENDING',
  'VALIDATED',
  'SIMULATED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type ProvisioningStatus = (typeof PROVISIONING_STATUSES)[number];

export interface ProvisioningPlanStep {
  id: string;
  description: string;
}

export interface ProvisioningAction {
  id: string;
  actionType: ProvisioningActionType;
  customerId: string;
  customerName?: string;
  targetPlanId?: string;
  targetPlanName?: string;
  decisionSource: ProvisioningDecisionSource;
  executionPlan: ProvisioningPlanStep[];
  previousState: ProvisioningStatus | null;
  nextState: ProvisioningStatus;
  status: ProvisioningStatus;
  actor: string;
  createdAt: string;
  updatedAt: string;
  dryRun: boolean;
  simulationResult?: string;
  rejectionReason?: string;
  notes?: string;
}

export interface ProvisioningAuditEntry {
  id: string;
  actionId: string;
  actionType: ProvisioningActionType;
  customerId: string;
  executionPlan: ProvisioningPlanStep[];
  previousState: ProvisioningStatus | null;
  nextState: ProvisioningStatus;
  actor: string;
  createdAt: string;
  dryRun: boolean;
}

export interface ProvisioningActionDetail {
  action: ProvisioningAction;
  audit: ProvisioningAuditEntry[];
}

export interface CreateProvisioningActionInput {
  actionType?: unknown;
  customerId?: unknown;
  customerName?: unknown;
  targetPlanId?: unknown;
  targetPlanName?: unknown;
  decisionSource?: unknown;
  notes?: unknown;
}

export interface ProvisioningSummary {
  total: number;
  pending: number;
  validated: number;
  simulated: number;
  approved: number;
  rejected: number;
  cancelled: number;
  dryRun: boolean;
}
