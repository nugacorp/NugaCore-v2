export const PROVISIONING_ACTION_TYPES = [
  'SUSPEND_CUSTOMER',
  'REACTIVATE_CUSTOMER',
  'CHANGE_PLAN',
  'CREATE_CUSTOMER',
  'CANCEL_CUSTOMER',
] as const;
export type ProvisioningActionType = (typeof PROVISIONING_ACTION_TYPES)[number];

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
  executionPlan: ProvisioningPlanStep[];
  previousState: ProvisioningStatus | null;
  nextState: ProvisioningStatus;
  status: ProvisioningStatus;
  actor: string;
  createdAt: string;
  updatedAt: string;
  dryRun: true;
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
  dryRun: true;
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
  dryRun: true;
}
