// ====================================================================
// Mappers del dominio Payment Engine (Fase 4.8).
// Convierte filas DB (snake_case) ↔ records (camelCase).
// Montos: DB en centavos, API en pesos.
// ====================================================================

import {
  MikrotikActionRecord,
  MikrotikActionView,
  PAYMENT_ORDER_STATUS_LABELS,
  PaymentEventRecord,
  PaymentEventView,
  PaymentOrderRecord,
  PaymentOrderView,
  PaymentProvider,
  MikrotikActionType,
  MikrotikActionStatus,
  PaymentOrderStatus,
} from './types';

// ── DB row shapes ────────────────────────────────────────────────────

export interface PaymentOrderRow {
  id: string;
  tenant_id?: string | null;
  customer_id: string;
  invoice_id: string;
  provider: string;
  provider_order_id?: string | null;
  amount_cents: number;
  status: string;
  checkout_url?: string | null;
  expires_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PaymentEventRow {
  id: string;
  tenant_id?: string | null;
  provider: string;
  provider_event_id: string;
  event_type: string;
  processed: boolean;
  payment_order_id?: string | null;
  payload: Record<string, unknown>;
  received_at?: string | null;
  processed_at?: string | null;
  claimed_at?: string | null;
  claim_token?: string | null;
}

export interface MikrotikActionRow {
  id: string;
  tenant_id?: string | null;
  customer_id: string;
  router_id?: string | null;
  action_type: string;
  status: string;
  dry_run: boolean;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  triggered_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── PaymentOrder mappers ──────────────────────────────────────────────

export const rowToPaymentOrder = (r: PaymentOrderRow): PaymentOrderRecord => ({
  id: r.id,
  tenantId: r.tenant_id || 'tenant-default',
  customerId: r.customer_id,
  invoiceId: r.invoice_id,
  provider: r.provider as PaymentProvider,
  providerOrderId: r.provider_order_id ?? undefined,
  amountCents: r.amount_cents,
  status: r.status as PaymentOrderStatus,
  checkoutUrl: r.checkout_url ?? undefined,
  expiresAt: r.expires_at ?? undefined,
  metadata: r.metadata ?? undefined,
  createdAt: r.created_at ?? new Date().toISOString(),
  updatedAt: r.updated_at ?? new Date().toISOString(),
});

export const paymentOrderToRow = (rec: PaymentOrderRecord): Record<string, unknown> => ({
  id: rec.id,
  tenant_id: rec.tenantId || 'tenant-default',
  customer_id: rec.customerId,
  invoice_id: rec.invoiceId,
  provider: rec.provider,
  provider_order_id: rec.providerOrderId ?? null,
  amount_cents: rec.amountCents,
  status: rec.status,
  checkout_url: rec.checkoutUrl ?? null,
  expires_at: rec.expiresAt ?? null,
  metadata: rec.metadata ?? null,
  created_at: rec.createdAt,
  updated_at: rec.updatedAt,
});

export const paymentOrderToView = (rec: PaymentOrderRecord): PaymentOrderView => ({
  id: rec.id,
  tenantId: rec.tenantId || 'tenant-default',
  customerId: rec.customerId,
  invoiceId: rec.invoiceId,
  provider: rec.provider,
  providerOrderId: rec.providerOrderId,
  amountPesos: rec.amountCents / 100,
  status: rec.status,
  statusLabel: PAYMENT_ORDER_STATUS_LABELS[rec.status],
  checkoutUrl: rec.checkoutUrl,
  expiresAt: rec.expiresAt,
  createdAt: rec.createdAt,
  updatedAt: rec.updatedAt,
});

// ── PaymentEvent mappers ──────────────────────────────────────────────

export const rowToPaymentEvent = (r: PaymentEventRow): PaymentEventRecord => ({
  id: r.id,
  tenantId: r.tenant_id || 'tenant-default',
  provider: r.provider as PaymentProvider,
  providerEventId: r.provider_event_id,
  eventType: r.event_type,
  processed: r.processed,
  paymentOrderId: r.payment_order_id ?? undefined,
  payload: r.payload,
  receivedAt: r.received_at ?? new Date().toISOString(),
  processedAt: r.processed_at ?? undefined,
  claimedAt: r.claimed_at ?? undefined,
  claimToken: r.claim_token ?? undefined,
});

export const paymentEventToView = (rec: PaymentEventRecord): PaymentEventView => ({
  id: rec.id,
  provider: rec.provider,
  providerEventId: rec.providerEventId,
  eventType: rec.eventType,
  processed: rec.processed,
  paymentOrderId: rec.paymentOrderId,
  receivedAt: rec.receivedAt,
  processedAt: rec.processedAt,
});

// ── MikrotikAction mappers ────────────────────────────────────────────

export const rowToMikrotikAction = (r: MikrotikActionRow): MikrotikActionRecord => ({
  id: r.id,
  tenantId: r.tenant_id || 'tenant-default',
  customerId: r.customer_id,
  routerId: r.router_id ?? undefined,
  actionType: r.action_type as MikrotikActionType,
  status: r.status as MikrotikActionStatus,
  dryRun: r.dry_run,
  payload: r.payload ?? undefined,
  result: r.result ?? undefined,
  triggeredBy: r.triggered_by ?? undefined,
  createdAt: r.created_at ?? new Date().toISOString(),
  updatedAt: r.updated_at ?? new Date().toISOString(),
});

export const mikrotikActionToRow = (rec: MikrotikActionRecord): Record<string, unknown> => ({
  id: rec.id,
  tenant_id: rec.tenantId || 'tenant-default',
  customer_id: rec.customerId,
  router_id: rec.routerId ?? null,
  action_type: rec.actionType,
  status: rec.status,
  dry_run: rec.dryRun,
  payload: rec.payload ?? null,
  result: rec.result ?? null,
  triggered_by: rec.triggeredBy ?? null,
  created_at: rec.createdAt,
  updated_at: rec.updatedAt,
});

export const mikrotikActionToView = (rec: MikrotikActionRecord): MikrotikActionView => ({
  id: rec.id,
  tenantId: rec.tenantId || 'tenant-default',
  customerId: rec.customerId,
  routerId: rec.routerId,
  actionType: rec.actionType,
  status: rec.status,
  dryRun: rec.dryRun,
  result: rec.result,
  triggeredBy: rec.triggeredBy,
  createdAt: rec.createdAt,
  updatedAt: rec.updatedAt,
});
