import { aggregateBillingStatus } from '../suspension/engine';
import { getSuspensionService } from '../suspension/service';
import type { SuspensionBlockCategory } from '../suspension/types';
import { rootActionIdempotencyKey } from './idempotency';
import type {
  AutomaticReactivationDecision,
  AutomaticReactivationDecisionOutcome,
} from './types';

export interface EvaluateAutomaticReactivationInput {
  tenantId: string;
  customerId: string;
  canonicalPaymentId: string;
  invoiceId?: string;
  origin: 'webhook' | 'manual';
}

const isBlockingBillingStatus = (billingStatus: string | undefined): boolean =>
  billingStatus === 'DELINQUENT';

const decisionReason: Record<AutomaticReactivationDecisionOutcome, string> = {
  eligible: 'Pago confirmado y deuda bloqueante liquidada; procede reactivacion automatica.',
  blocked_overdue: 'Pago confirmado, pero el cliente conserva deuda vencida bloqueante.',
  blocked_non_financial: 'Pago confirmado, pero existe un bloqueo no financiero activo.',
  blocked_unknown: 'Pago confirmado, pero existe un bloqueo de clasificacion desconocida.',
  automation_disabled: 'Pago confirmado, pero la automatizacion de reactivacion esta deshabilitada.',
  already_active: 'Pago confirmado, pero el cliente ya esta activo.',
  customer_not_found: 'Pago confirmado, pero el cliente no existe en el tenant.',
  not_serviceable: 'Pago confirmado, pero el cliente no esta suspendido ni activo.',
};

const categoryOf = (categories: SuspensionBlockCategory[]): AutomaticReactivationDecisionOutcome | null => {
  if (categories.includes('unknown')) return 'blocked_unknown';
  if (categories.includes('non_financial')) return 'blocked_non_financial';
  return null;
};

export async function evaluateAutomaticPaymentReactivation(
  input: EvaluateAutomaticReactivationInput,
): Promise<AutomaticReactivationDecision> {
  const { repo, data } = getSuspensionService();
  const [policy, customer, invoices, activeBlocks] = await Promise.all([
    repo.getPolicy(),
    data.getCustomer(input.customerId, input.tenantId),
    data.loadInvoices(input.tenantId),
    repo.listSuspensionBlocks({
      tenantId: input.tenantId,
      customerId: input.customerId,
      activeOnly: true,
    }),
  ]);

  const customerInvoices = invoices.filter((invoice) => invoice.clientId === input.customerId);
  const { billingStatus } = aggregateBillingStatus(customerInvoices, policy);
  const activeBlockCategories = activeBlocks.map((block) => block.category);
  const rootKey = rootActionIdempotencyKey(input.canonicalPaymentId, input.customerId);
  let outcome: AutomaticReactivationDecisionOutcome;

  if (!customer) outcome = 'customer_not_found';
  else if (customer.status === 'active') outcome = 'already_active';
  else if (customer.status !== 'suspended') outcome = 'not_serviceable';
  else if (!policy.enabled || !policy.autoReactivate || !policy.reactivateOnPayment) outcome = 'automation_disabled';
  else if (isBlockingBillingStatus(billingStatus)) outcome = 'blocked_overdue';
  else outcome = categoryOf(activeBlockCategories) ?? 'eligible';

  return {
    tenantId: input.tenantId,
    customerId: input.customerId,
    canonicalPaymentId: input.canonicalPaymentId,
    invoiceId: input.invoiceId,
    origin: input.origin,
    eligible: outcome === 'eligible',
    outcome,
    reason: decisionReason[outcome],
    billingStatus,
    blockingDebt: isBlockingBillingStatus(billingStatus),
    activeBlockCategories,
    reactivationIdempotencyKey: rootKey,
    idempotencyKey: `${rootKey}:eligibility:${outcome}`,
  };
}

export async function recordAutomaticReactivationDecision(
  decision: AutomaticReactivationDecision,
): Promise<void> {
  const { repo } = getSuspensionService();
  await repo.recordEvent({
    tenantId: decision.tenantId,
    customerId: decision.customerId,
    invoiceId: decision.invoiceId,
    eventType: 'evaluated',
    automatic: true,
    reason: decision.reason,
    metadata: {
      kind: 'automatic_payment_reactivation',
      origin: decision.origin,
      outcome: decision.outcome,
      eligible: decision.eligible,
      canonicalPaymentId: decision.canonicalPaymentId,
      billingStatus: decision.billingStatus,
      blockingDebt: decision.blockingDebt,
      activeBlockCategories: decision.activeBlockCategories,
    },
    idempotencyKey: decision.idempotencyKey,
  });
}
