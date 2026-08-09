// ====================================================================
// Mappers del dominio Suspension (Fase 4.5.1) — filas Postgres ↔ dominio.
// Tablas: suspension_policies, customer_service_state, suspension_events,
//         suspension_orders, reactivation_orders.
// ====================================================================

import {
  CustomerServiceState,
  ServiceStatus,
  BillingStatus,
  SuspensionEvent,
  SuspensionEventType,
  SuspensionOrder,
  SuspensionPolicyV2,
  OrderStatus,
} from './types';

// ── Política ───────────────────────────────────────────────────────────
export interface PolicyRow {
  id: string;
  name: string;
  enabled: boolean;
  grace_days: number;
  suspend_after_due: boolean;
  reactivate_on_payment: boolean;
  reactivate_on_partial_payment: boolean;
  auto_reactivate: boolean;
  due_soon_days?: number | null; // puede no existir en la tabla → default 3
  updated_at?: string;
}

export const rowToPolicy = (r: PolicyRow): SuspensionPolicyV2 => ({
  id: r.id,
  name: r.name,
  enabled: r.enabled,
  graceDays: r.grace_days,
  suspendAfterDue: r.suspend_after_due,
  reactivateOnPayment: r.reactivate_on_payment,
  reactivateOnPartialPayment: r.reactivate_on_partial_payment,
  autoReactivate: r.auto_reactivate,
  dueSoonDays: typeof r.due_soon_days === 'number' ? r.due_soon_days : 3,
  updatedAt: r.updated_at || new Date().toISOString(),
});

export const policyToRow = (p: SuspensionPolicyV2): Record<string, unknown> => ({
  id: p.id,
  name: p.name,
  enabled: p.enabled,
  grace_days: p.graceDays,
  suspend_after_due: p.suspendAfterDue,
  reactivate_on_payment: p.reactivateOnPayment,
  reactivate_on_partial_payment: p.reactivateOnPartialPayment,
  auto_reactivate: p.autoReactivate,
});

// ── Estado de servicio ──────────────────────────────────────────────────
export interface StateRow {
  customer_id: string;
  service_status: ServiceStatus;
  billing_status: BillingStatus;
  network_status: string;
  last_evaluated_at: string | null;
  last_suspension_at: string | null;
  last_reactivation_at: string | null;
  current_reason: string | null;
  updated_at?: string;
}

export const rowToState = (r: StateRow, customerName = ''): CustomerServiceState => ({
  customerId: r.customer_id,
  customerName,
  serviceStatus: r.service_status,
  billingStatus: r.billing_status,
  networkStatus: r.network_status,
  lastEvaluatedAt: r.last_evaluated_at || '',
  lastSuspensionAt: r.last_suspension_at || undefined,
  lastReactivationAt: r.last_reactivation_at || undefined,
  currentReason: r.current_reason || undefined,
  updatedAt: r.updated_at || new Date().toISOString(),
});

export const stateToRow = (s: CustomerServiceState): Record<string, unknown> => ({
  customer_id: s.customerId,
  service_status: s.serviceStatus,
  billing_status: s.billingStatus,
  network_status: s.networkStatus,
  last_evaluated_at: s.lastEvaluatedAt || null,
  last_suspension_at: s.lastSuspensionAt || null,
  last_reactivation_at: s.lastReactivationAt || null,
  current_reason: s.currentReason || null,
});

// ── Evento ──────────────────────────────────────────────────────────────
export interface EventRow {
  id: string;
  customer_id: string;
  invoice_id: string | null;
  event_type: SuspensionEventType;
  reason: string | null;
  automatic: boolean;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  tenant_id?: string | null;
  idempotency_key?: string | null;
}

export const rowToEvent = (r: EventRow): SuspensionEvent => ({
  id: r.id,
  customerId: r.customer_id,
  invoiceId: r.invoice_id || undefined,
  eventType: r.event_type,
  reason: r.reason || undefined,
  automatic: r.automatic,
  actorId: r.actor_id || undefined,
  metadata: r.metadata || undefined,
  createdAt: r.created_at,
  tenantId: r.tenant_id || undefined,
  idempotencyKey: r.idempotency_key || undefined,
});

export const eventToRow = (e: SuspensionEvent): Record<string, unknown> => {
  const row: Record<string, unknown> = {
    id: e.id,
    customer_id: e.customerId,
    invoice_id: e.invoiceId || null,
    event_type: e.eventType,
    reason: e.reason || null,
    automatic: e.automatic,
    actor_id: e.actorId || null,
    metadata: e.metadata || null,
  };
  // Sólo viajan cuando el efecto tiene identidad durable, para que el motor y
  // las rutas manuales sigan insertando contra un schema sin migrar.
  if (e.tenantId !== undefined) row.tenant_id = e.tenantId;
  if (e.idempotencyKey !== undefined) row.idempotency_key = e.idempotencyKey;
  return row;
};

// ── Orden ───────────────────────────────────────────────────────────────
export interface OrderRow {
  id: string;
  customer_id: string;
  router_id?: string | null;
  invoice_id: string | null;
  status: OrderStatus;
  source: 'engine' | 'manual' | 'payment-engine' | 'provisioning-center' | 'service-status';
  reason: string | null;
  scheduled_for: string | null;
  executed_at: string | null;
  created_at: string;
  tenant_id?: string | null;
  idempotency_key?: string | null;
}

export const rowToOrder = (r: OrderRow, orderType: SuspensionOrder['orderType']): SuspensionOrder => ({
  id: r.id,
  customerId: r.customer_id,
  routerId: r.router_id || undefined,
  invoiceId: r.invoice_id || undefined,
  orderType,
  status: r.status,
  source: r.source,
  reason: r.reason || undefined,
  scheduledFor: r.scheduled_for || undefined,
  executedAt: r.executed_at || undefined,
  createdAt: r.created_at,
  tenantId: r.tenant_id || undefined,
  idempotencyKey: r.idempotency_key || undefined,
});

export const orderToRow = (o: SuspensionOrder): Record<string, unknown> => {
  const row: Record<string, unknown> = {
    id: o.id,
    customer_id: o.customerId,
    invoice_id: o.invoiceId || null,
    status: o.status,
    source: o.source,
    reason: o.reason || null,
    scheduled_for: o.scheduledFor || null,
    executed_at: o.executedAt || null,
  };
  if (o.tenantId !== undefined) row.tenant_id = o.tenantId;
  if (o.routerId !== undefined) row.router_id = o.routerId;
  if (o.idempotencyKey !== undefined) row.idempotency_key = o.idempotencyKey;
  return row;
};
