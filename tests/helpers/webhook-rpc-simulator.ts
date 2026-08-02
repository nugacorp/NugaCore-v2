// ====================================================================
// Traducción a JS de las funciones SQL de T5, montadas sobre el doble de
// PostgREST. Es la única forma de ejercitar la semántica transaccional
// (precedencia ownership → already_applied, unión monotónica, recálculo del
// ledger bajo lock) en una suite hermética sin Postgres.
//
// El texto SQL real se verifica aparte, de forma estática, en
// `tests/unit/payments.webhook-durable-idempotency-migration.test.ts`.
// ====================================================================

import { FakePostgrest } from './fake-postgrest';
import { tenantScopedIdempotencyId } from '../../backend/common/idempotency';

export const CHECKPOINT_RPC = 'payments_checkpoint_reactivation_step';
export const BILLING_WEBHOOK_RPC = 'billing_apply_webhook_payment';
export const CAPABILITY_RPC = 'payments_webhook_schema_capability';

const PROGRESS_KEY = '_webhookReactivationProgress';

const ALLOWED_STEPS = new Set([
  'customerReactivated',
  'timelineAdded',
  'networkDispatched',
  'suspensionEventRecorded',
  'alertCreated',
]);

type Row = Record<string, unknown>;

const asObject = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};

export const registerWebhookRpcs = (db: FakePostgrest): void => {
  db.registerRpc(CAPABILITY_RPC, () => ({ ready: true, missing: [] }));

  db.registerRpc(CHECKPOINT_RPC, (args) => {
    const step = String(args.p_step ?? '');
    if (!ALLOWED_STEPS.has(step)) throw new Error(`invalid checkpoint step: ${step}`);

    // Lock order: payment_event y DESPUÉS mikrotik_action (igual que el SQL).
    const event = db.rows('payment_events').find(
      (row) => row.id === args.p_event_id && row.tenant_id === args.p_tenant_id,
    );
    if (!event) throw new Error('payment event not found for checkpoint');

    // Ownership primero: un owner vencido nunca puede leer `already_applied`.
    if (event.processed === true || event.claim_token !== args.p_claim_token) return 'ownership_lost';

    const action = db.rows('mikrotik_actions').find(
      (row) => row.id === args.p_action_id && row.tenant_id === args.p_tenant_id,
    );
    if (!action) throw new Error('mikrotik action not found for checkpoint');
    if (action.payment_event_id !== args.p_event_id) {
      throw new Error('mikrotik action is not linked to the payment event');
    }

    const result = asObject(action.result);
    const progress = asObject(result[PROGRESS_KEY]);
    if (progress[step] === true) return 'already_applied';

    // Unión monotónica: nunca reemplaza el objeto completo.
    action.result = { ...result, [PROGRESS_KEY]: { ...progress, [step]: true } };
    return 'applied';
  });

  db.registerRpc(BILLING_WEBHOOK_RPC, (args) => {
    const event = db.rows('payment_events').find(
      (row) => row.id === args.p_event_id && row.tenant_id === args.p_tenant_id,
    );
    if (!event) throw new Error('payment event not found for billing apply');
    if (event.processed === true || event.claim_token !== args.p_claim_token) {
      return {
        outcome: 'ownership_lost',
        was_settled_before: false,
        is_settled_after: false,
        settlement_winner: false,
      };
    }

    const invoice = db.rows('invoices').find(
      (row) => row.id === args.p_invoice_id && row.tenant_id === args.p_tenant_id,
    );
    if (!invoice) throw new Error('invoice not found for billing apply');
    const totalCents = Number(invoice.total_cents ?? Math.round(Number(invoice.amount ?? 0) * 100));
    const wasSettledBefore = invoice.status === 'paid'
      && Number(invoice.applied_cents ?? 0) >= totalCents;

    const amountCents = Number(args.p_amount_cents);
    const existingByCharge = db.rows('payments').find(
      (row) => row.tenant_id === args.p_tenant_id
        && row.provider === args.p_provider
        && row.transaction_id === args.p_transaction_id,
    );
    const existingByKey = db.rows('payments').find(
      (row) => row.tenant_id === args.p_tenant_id && row.idempotency_key === args.p_idempotency_key,
    );
    if (existingByCharge && existingByKey && existingByCharge.id !== existingByKey.id) {
      throw new Error('idempotency_conflict: charge identity and key point to different rows');
    }
    const existing = existingByCharge ?? existingByKey;

    let paymentId: string;
    let outcome: 'created' | 'existing';
    if (existing) {
      if (
        Number(existing.amount_cents) !== amountCents
        || existing.client_id !== invoice.client_id
        || existing.method !== args.p_method
        || existing.provider !== args.p_provider
        || (existing.transaction_id ?? null) !== (args.p_transaction_id ?? null)
        || existing.status !== 'confirmed'
      ) {
        throw new Error('idempotency_conflict: payment payload differs for the same key');
      }
      paymentId = String(existing.id);
      outcome = 'existing';
    } else {
      paymentId = tenantScopedIdempotencyId(
        'pay',
        String(args.p_tenant_id),
        String(args.p_idempotency_key),
      );
      const payment = {
        id: paymentId,
        tenant_id: args.p_tenant_id,
        client_id: invoice.client_id,
        client_name: invoice.client_name,
        amount_cents: amountCents,
        method: args.p_method,
        provider: args.p_provider,
        transaction_id: args.p_transaction_id ?? null,
        idempotency_key: args.p_idempotency_key,
        payment_date: new Date().toISOString(),
        status: 'confirmed',
      };
      const violation = db.uniqueViolation('payments', payment);
      if (violation) throw new Error(`duplicate key value violates unique constraint "${violation}"`);
      db.rows('payments').push(payment);
      outcome = 'created';
    }

    // Una sola application por (payment, invoice), como exige la constraint.
    const applications = db.rows('payment_applications').filter((row) => row.payment_id === paymentId);
    const conflictingApplication = applications.find(
      (row) =>
        row.invoice_id !== args.p_invoice_id
        || row.tenant_id !== args.p_tenant_id
        || Number(row.applied_cents) !== amountCents,
    );
    if (conflictingApplication) {
      throw new Error('idempotency_conflict: payment application payload differs for the same key');
    }
    const application = applications.find((row) => row.invoice_id === args.p_invoice_id);
    if (!application) {
      const candidate = {
        id: tenantScopedIdempotencyId(
          'pa',
          String(args.p_tenant_id),
          String(args.p_idempotency_key),
        ),
        tenant_id: args.p_tenant_id,
        payment_id: paymentId,
        invoice_id: args.p_invoice_id,
        applied_cents: amountCents,
        applied_at: new Date().toISOString(),
      };
      const violation = db.uniqueViolation('payment_applications', candidate);
      if (violation) throw new Error(`duplicate key value violates unique constraint "${violation}"`);
      db.rows('payment_applications').push(candidate);
    }

    // Recálculo desde la suma real de aplicaciones: no hay lost update posible.
    const appliedCents = db.rows('payment_applications')
      .filter((row) => row.invoice_id === args.p_invoice_id)
      .reduce((sum, row) => sum + Number(row.applied_cents ?? 0), 0);
    invoice.applied_cents = appliedCents;
    invoice.amount_paid = Math.round(appliedCents) / 100;
    if (invoice.status === 'canceled') {
      invoice.cfdi_status = 'canceled';
    } else if (appliedCents >= totalCents) {
      invoice.status = 'paid';
      invoice.cfdi_status = 'generated';
      invoice.cfdi_uuid ||= `cfdi-${paymentId}`;
    } else {
      invoice.status = new Date(String(invoice.due_date)).getTime() < Date.now()
        ? 'overdue'
        : 'unpaid';
      if (invoice.cfdi_status === 'generated') invoice.cfdi_status = 'pending';
    }
    const isSettledAfter = invoice.status === 'paid' && appliedCents >= totalCents;
    const settlementWinner = outcome === 'created' && !wasSettledBefore && isSettledAfter;
    const payment = db.rows('payments').find((row) => row.id === paymentId)!;
    if (settlementWinner) payment.settlement_winner = true;
    return {
      outcome,
      was_settled_before: wasSettledBefore,
      is_settled_after: isSettledAfter,
      settlement_winner: payment.settlement_winner === true,
    };
  });
};

/** Índices únicos parciales que introduce la migración de T5. */
export const registerWebhookUniqueIndexes = (db: FakePostgrest): void => {
  for (const table of [
    'mikrotik_actions',
    'client_timeline',
    'reactivation_orders',
    'suspension_events',
    'noc_alerts',
    'payments',
    'payment_applications',
  ]) {
    db.addUniqueIndex(`${table}_pkey`, { table, columns: ['id'] });
  }

  const partialTenantKey = (table: string, name: string) =>
    db.addUniqueIndex(name, {
      table,
      columns: ['tenant_id', 'idempotency_key'],
      where: (row) => row.idempotency_key !== null && row.idempotency_key !== undefined,
    });

  partialTenantKey('mikrotik_actions', 'uq_mikrotik_actions_tenant_idempotency');
  partialTenantKey('client_timeline', 'uq_client_timeline_tenant_idempotency');
  partialTenantKey('reactivation_orders', 'uq_reactivation_orders_tenant_idempotency');
  partialTenantKey('suspension_events', 'uq_suspension_events_tenant_idempotency');
  partialTenantKey('noc_alerts', 'uq_noc_alerts_tenant_idempotency');
  partialTenantKey('payments', 'uq_payments_tenant_idempotency');
  db.addUniqueIndex('uq_payments_tenant_provider_transaction', {
    table: 'payments',
    columns: ['tenant_id', 'provider', 'transaction_id'],
    where: (row) => row.provider != null && row.transaction_id != null,
  });
};
