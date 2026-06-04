// ====================================================================
// Motor de Suspensiones (Fase 4.5).
//
// DECIDE y emite ÓRDENES (suspensión/reactivación). NO ejecuta acciones,
// NO muta el estado de red del cliente, NO toca MikroTik. El Worker (fase
// 4.6) consumirá las órdenes PENDING.
// ====================================================================

import { Invoice } from '../../../src/types';
import { store } from '../../state/store';
import { engineStore } from './engine-store';
import {
  BillingStatus,
  EvaluationResult,
  ServiceStatus,
  SuspensionPolicyV2,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const round = (v: number) => Math.round(v * 100) / 100;

// ── Helpers de factura ────────────────────────────────────────────────
const paidOf = (inv: Invoice): number =>
  typeof inv.paidAmount === 'number'
    ? round(inv.paidAmount)
    : round((inv.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));

const pendingOf = (inv: Invoice): number =>
  typeof inv.pendingAmount === 'number'
    ? round(inv.pendingAmount)
    : round(Math.max(inv.amount - paidOf(inv), 0));

const isOpen = (inv: Invoice): boolean => inv.status !== 'canceled' && pendingOf(inv) > 0;

/** Clasifica UNA factura abierta respecto al vencimiento y la gracia. */
export function evaluateInvoice(
  inv: Invoice,
  policy: SuspensionPolicyV2,
  now = Date.now(),
): 'current' | 'due_soon' | 'overdue' | 'delinquent' | 'closed' {
  if (!isOpen(inv)) return 'closed';
  const dueMs = new Date(inv.dueDateStr).getTime();
  if (!Number.isFinite(dueMs)) return 'current';
  if (now - dueMs >= policy.graceDays * DAY_MS) return 'delinquent';
  if (dueMs <= now) return 'overdue';
  if (dueMs - now <= policy.dueSoonDays * DAY_MS) return 'due_soon';
  return 'current';
}

const SEVERITY: Record<string, number> = { closed: 0, current: 1, due_soon: 2, overdue: 3, delinquent: 4 };

/** Estado de cobranza agregado del cliente (la peor factura manda). */
export function evaluateBillingState(
  customerId: string,
  policy = engineStore.POLICY,
  now = Date.now(),
): { billingStatus: BillingStatus; worstInvoiceId?: string; partialPaid: boolean } {
  const invoices = store.INVOICES.filter((i) => i.clientId === customerId);
  let worst = 'current';
  let worstInvoiceId: string | undefined;
  let partialPaid = false;

  for (const inv of invoices) {
    if (isOpen(inv) && paidOf(inv) > 0) partialPaid = true;
    const klass = evaluateInvoice(inv, policy, now);
    if (SEVERITY[klass] > SEVERITY[worst]) {
      worst = klass;
      if (klass !== 'closed' && klass !== 'current') worstInvoiceId = inv.id;
    }
  }

  const billingStatus: BillingStatus =
    worst === 'delinquent' ? 'DELINQUENT'
    : worst === 'overdue' ? 'OVERDUE'
    : worst === 'due_soon' ? 'DUE_SOON'
    : 'CURRENT';

  return { billingStatus, worstInvoiceId, partialPaid };
}

// ── Decisión pura (sin efectos) ───────────────────────────────────────
export interface ServiceDecision {
  serviceStatus: ServiceStatus;
  action: 'none' | 'create_suspension' | 'create_reactivation';
  reason: string;
}

export function decideServiceStatus(params: {
  networkStatus: string; // 'active' | 'suspended' | ...
  billingStatus: BillingStatus;
  partialPaid: boolean;
  hasOpenSuspensionOrder: boolean;
  hasOpenReactivationOrder: boolean;
  policy: SuspensionPolicyV2;
}): ServiceDecision {
  const { networkStatus, billingStatus, partialPaid, hasOpenSuspensionOrder, hasOpenReactivationOrder, policy } = params;

  if (!policy.enabled) {
    return {
      serviceStatus: networkStatus === 'suspended' ? 'SUSPENDED' : 'ACTIVE',
      action: 'none',
      reason: 'Política de suspensiones deshabilitada.',
    };
  }

  // Cliente activo en red
  if (networkStatus === 'active') {
    if (billingStatus === 'DELINQUENT') {
      if (!policy.suspendAfterDue) {
        return { serviceStatus: 'WARNING', action: 'none', reason: 'Moroso, pero suspend_after_due=false.' };
      }
      if (hasOpenSuspensionOrder) {
        return { serviceStatus: 'PENDING_SUSPENSION', action: 'none', reason: 'Orden de suspensión ya pendiente.' };
      }
      return {
        serviceStatus: 'PENDING_SUSPENSION',
        action: 'create_suspension',
        reason: `Morosidad fuera de la ventana de gracia (${policy.graceDays} días).`,
      };
    }
    if (billingStatus === 'OVERDUE') {
      return { serviceStatus: 'WARNING', action: 'none', reason: 'Factura vencida dentro de la ventana de gracia.' };
    }
    return { serviceStatus: 'ACTIVE', action: 'none', reason: 'Cobranza al corriente.' };
  }

  // Cliente suspendido en red
  if (networkStatus === 'suspended') {
    const regularized = billingStatus === 'CURRENT' || billingStatus === 'DUE_SOON';
    const canReactivate = policy.autoReactivate && policy.reactivateOnPayment;

    if (regularized && canReactivate) {
      if (hasOpenReactivationOrder) {
        return { serviceStatus: 'PENDING_REACTIVATION', action: 'none', reason: 'Orden de reactivación ya pendiente.' };
      }
      return {
        serviceStatus: 'PENDING_REACTIVATION',
        action: 'create_reactivation',
        reason: 'Saldo regularizado: procede reactivación.',
      };
    }

    // Pago parcial con política que lo permite
    if (!regularized && partialPaid && policy.reactivateOnPartialPayment && policy.autoReactivate) {
      if (hasOpenReactivationOrder) {
        return { serviceStatus: 'PENDING_REACTIVATION', action: 'none', reason: 'Orden de reactivación ya pendiente.' };
      }
      return {
        serviceStatus: 'PENDING_REACTIVATION',
        action: 'create_reactivation',
        reason: 'Pago parcial aplicado (reactivate_on_partial_payment=true).',
      };
    }

    return { serviceStatus: 'SUSPENDED', action: 'none', reason: 'Suspendido: saldo pendiente.' };
  }

  // lead / baja: no evaluable como servicio
  return { serviceStatus: 'ACTIVE', action: 'none', reason: 'Cliente no serviceable (lead/baja).' };
}

// ── Evaluación con efectos (estado, eventos, órdenes) ─────────────────
const SERVICEABLE = new Set(['active', 'suspended']);

export function evaluateCustomerById(customerId: string, actorId?: string): EvaluationResult | null {
  const client = store.CLIENTS.find((c) => c.id === customerId);
  if (!client) return null;

  const policy = engineStore.POLICY;
  const now = Date.now();
  const { billingStatus, worstInvoiceId, partialPaid } = evaluateBillingState(customerId, policy, now);

  const prev = engineStore.getState(customerId);
  const previousServiceStatus = prev ? prev.serviceStatus : null;

  // No serviceable (lead/baja): registra estado informativo, sin órdenes.
  if (!SERVICEABLE.has(client.status)) {
    const state = engineStore.upsertState({
      customerId,
      customerName: client.name,
      serviceStatus: prev?.serviceStatus ?? 'ACTIVE',
      billingStatus,
      networkStatus: client.status,
      lastEvaluatedAt: new Date(now).toISOString(),
      lastSuspensionAt: prev?.lastSuspensionAt,
      lastReactivationAt: prev?.lastReactivationAt,
      currentReason: 'Cliente no serviceable (lead/baja).',
      updatedAt: new Date(now).toISOString(),
    });
    return {
      customerId,
      customerName: client.name,
      previousServiceStatus,
      serviceStatus: state.serviceStatus,
      billingStatus,
      networkStatus: client.status,
      changed: false,
      action: 'none',
      reason: state.currentReason!,
    };
  }

  const decision = decideServiceStatus({
    networkStatus: client.status,
    billingStatus,
    partialPaid,
    hasOpenSuspensionOrder: engineStore.openOrders(customerId, 'suspension').length > 0,
    hasOpenReactivationOrder: engineStore.openOrders(customerId, 'reactivation').length > 0,
    policy,
  });

  // Generar órdenes (idempotente) — NO ejecuta nada.
  let orderId: string | undefined;
  if (decision.action === 'create_suspension') {
    engineStore.cancelOpenOrders(customerId, 'reactivation', 'Reemplazada por nueva orden de suspensión.', actorId);
    const order = engineStore.createOrder({
      customerId,
      invoiceId: worstInvoiceId,
      orderType: 'suspension',
      source: 'engine',
      reason: decision.reason,
    });
    orderId = order.id;
    engineStore.recordEvent({
      customerId,
      invoiceId: worstInvoiceId,
      eventType: 'suspension_order_created',
      reason: decision.reason,
      automatic: true,
      actorId,
      metadata: { orderId: order.id, billingStatus },
    });
  } else if (decision.action === 'create_reactivation') {
    engineStore.cancelOpenOrders(customerId, 'suspension', 'Reemplazada por nueva orden de reactivación.', actorId);
    const order = engineStore.createOrder({
      customerId,
      invoiceId: worstInvoiceId,
      orderType: 'reactivation',
      source: 'engine',
      reason: decision.reason,
    });
    orderId = order.id;
    engineStore.recordEvent({
      customerId,
      invoiceId: worstInvoiceId,
      eventType: 'reactivation_order_created',
      reason: decision.reason,
      automatic: true,
      actorId,
      metadata: { orderId: order.id, billingStatus },
    });
  }

  const changed = previousServiceStatus !== decision.serviceStatus;
  const iso = new Date(now).toISOString();
  if (changed) {
    engineStore.recordEvent({
      customerId,
      invoiceId: worstInvoiceId,
      eventType: 'state_changed',
      reason: `${previousServiceStatus ?? 'NUEVO'} -> ${decision.serviceStatus}: ${decision.reason}`,
      automatic: true,
      actorId,
      metadata: { from: previousServiceStatus, to: decision.serviceStatus, billingStatus },
    });
  }

  engineStore.upsertState({
    customerId,
    customerName: client.name,
    serviceStatus: decision.serviceStatus,
    billingStatus,
    networkStatus: client.status,
    lastEvaluatedAt: iso,
    lastSuspensionAt:
      decision.action === 'create_suspension' ? iso : prev?.lastSuspensionAt,
    lastReactivationAt:
      decision.action === 'create_reactivation' ? iso : prev?.lastReactivationAt,
    currentReason: decision.reason,
    updatedAt: iso,
  });

  return {
    customerId,
    customerName: client.name,
    previousServiceStatus,
    serviceStatus: decision.serviceStatus,
    billingStatus,
    networkStatus: client.status,
    changed,
    action: decision.action,
    orderId,
    reason: decision.reason,
    invoiceId: worstInvoiceId,
  };
}

/** Decisión pura para un cliente (sin efectos) — útil para UI/tests. */
export function evaluateCustomer(customerId: string): ServiceDecision | null {
  const client = store.CLIENTS.find((c) => c.id === customerId);
  if (!client) return null;
  const { billingStatus, partialPaid } = evaluateBillingState(customerId);
  return decideServiceStatus({
    networkStatus: client.status,
    billingStatus,
    partialPaid,
    hasOpenSuspensionOrder: engineStore.openOrders(customerId, 'suspension').length > 0,
    hasOpenReactivationOrder: engineStore.openOrders(customerId, 'reactivation').length > 0,
    policy: engineStore.POLICY,
  });
}

export function evaluateAllCustomers(actorId?: string): EvaluationResult[] {
  const results: EvaluationResult[] = [];
  for (const client of store.CLIENTS) {
    const r = evaluateCustomerById(client.id, actorId);
    if (r) results.push(r);
  }
  return results;
}

/** Vista de cobranza por cliente (read-only, sin efectos) para la UI. */
export function customerServiceView() {
  const policy = engineStore.POLICY;
  return store.CLIENTS
    .filter((c) => c.status === 'active' || c.status === 'suspended')
    .map((c) => {
      const { billingStatus, worstInvoiceId, partialPaid } = evaluateBillingState(c.id, policy);
      const decision = decideServiceStatus({
        networkStatus: c.status,
        billingStatus,
        partialPaid,
        hasOpenSuspensionOrder: engineStore.openOrders(c.id, 'suspension').length > 0,
        hasOpenReactivationOrder: engineStore.openOrders(c.id, 'reactivation').length > 0,
        policy,
      });
      const stored = engineStore.getState(c.id);
      return {
        customerId: c.id,
        customerName: c.name,
        serviceStatus: decision.serviceStatus,
        billingStatus,
        networkStatus: c.status,
        reason: decision.reason,
        worstInvoiceId,
        lastEvaluatedAt: stored?.lastEvaluatedAt,
        lastSuspensionAt: stored?.lastSuspensionAt,
        lastReactivationAt: stored?.lastReactivationAt,
      };
    });
}

/** KPIs de suspensión para el dashboard (read-only, sin efectos). */
export function suspensionKpis(now = Date.now()) {
  const today = new Date(now).toISOString().substring(0, 10);
  let morosos = 0, active = 0, warning = 0, pendingSuspension = 0, suspended = 0, pendingReactivation = 0;

  for (const c of store.CLIENTS) {
    if (c.status !== 'active' && c.status !== 'suspended') continue;
    const view = customerStatusFor(c.id);
    if (view.billingStatus === 'DELINQUENT' || view.billingStatus === 'OVERDUE') morosos += 1;
    switch (view.serviceStatus) {
      case 'ACTIVE': active += 1; break;
      case 'WARNING': warning += 1; break;
      case 'PENDING_SUSPENSION': pendingSuspension += 1; break;
      case 'SUSPENDED': suspended += 1; break;
      case 'PENDING_REACTIVATION': pendingReactivation += 1; break;
    }
  }

  // El motor emite ÓRDENES; el Worker ejecuta. "Hoy" = órdenes creadas hoy.
  const suspendedToday = engineStore.ORDERS.filter(
    (o) => o.orderType === 'suspension' && o.createdAt.substring(0, 10) === today,
  ).length;
  const reactivatedToday = engineStore.ORDERS.filter(
    (o) => o.orderType === 'reactivation' && o.createdAt.substring(0, 10) === today,
  ).length;

  return { suspendedToday, reactivatedToday, morosos, pendingSuspension, pendingReactivation, active, warning, suspended };
}

function customerStatusFor(customerId: string): { serviceStatus: ServiceStatus; billingStatus: BillingStatus } {
  const policy = engineStore.POLICY;
  const client = store.CLIENTS.find((c) => c.id === customerId)!;
  const { billingStatus, partialPaid } = evaluateBillingState(customerId, policy);
  const decision = decideServiceStatus({
    networkStatus: client.status,
    billingStatus,
    partialPaid,
    hasOpenSuspensionOrder: engineStore.openOrders(customerId, 'suspension').length > 0,
    hasOpenReactivationOrder: engineStore.openOrders(customerId, 'reactivation').length > 0,
    policy,
  });
  return { serviceStatus: decision.serviceStatus, billingStatus };
}
