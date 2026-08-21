// ====================================================================
// Motor de Suspensiones (Fase 4.5 · corregido 4.5.1).
//
// DECIDE y emite ÓRDENES. NO ejecuta, NO muta el estado de red, NO toca
// MikroTik. Lee Customers/Billing a través del SuspensionDataProvider (datos
// REALES vivan en store o en Supabase) y persiste su propio estado mediante
// el SuspensionRepository (memoria o Supabase, según USE_DB_SUSPENSION).
// ====================================================================

import { Invoice } from '../../../src/types';
import { isHardenedRuntimeNow } from '../../config/env';
import { isDomainOnDb } from '../../config/feature-flags';
import { isMultiTenantEnabled } from '../tenancy/flags';
import { DEFAULT_TENANT_ID } from '../tenancy/types';
import { getSuspensionService } from './service';
import { CustomerLite } from './data-provider';
import {
  ensureEngineFinancialBlock,
  findDeterministicEngineFinancialOrder,
  findEngineFinancialOrder,
} from './financial-blocks';
import { SuspensionRepository } from './repository';
import {
  BillingStatus,
  EvaluationResult,
  ServiceStatus,
  SuspensionOrder,
  SuspensionPolicyV2,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const round = (v: number) => Math.round(v * 100) / 100;

// ── Helpers de factura (puros) ────────────────────────────────────────
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

/** Estado de cobranza agregado (puro): la peor factura del cliente manda. */
export function aggregateBillingStatus(
  invoices: Invoice[],
  policy: SuspensionPolicyV2,
  now = Date.now(),
): { billingStatus: BillingStatus; worstInvoiceId?: string; partialPaid: boolean } {
  let worst = 'current';
  let worstInvoiceId: string | undefined;
  let partialPaid = false;
  let lastClosedInvoiceId: string | undefined;

  for (const inv of invoices) {
    if (isOpen(inv) && paidOf(inv) > 0) partialPaid = true;
    const klass = evaluateInvoice(inv, policy, now);
    if (klass === 'closed') lastClosedInvoiceId = inv.id;
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

  return { billingStatus, worstInvoiceId: worstInvoiceId ?? lastClosedInvoiceId, partialPaid };
}

// ── Decisión pura (sin efectos) ───────────────────────────────────────
export interface ServiceDecision {
  serviceStatus: ServiceStatus;
  action: 'none' | 'create_suspension' | 'create_reactivation';
  reason: string;
}

export function decideServiceStatus(params: {
  networkStatus: string;
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

  if (networkStatus === 'suspended') {
    const regularized = billingStatus === 'CURRENT' || billingStatus === 'DUE_SOON';
    const canReactivate = policy.autoReactivate && policy.reactivateOnPayment;

    if (regularized && canReactivate) {
      if (hasOpenReactivationOrder) {
        return { serviceStatus: 'PENDING_REACTIVATION', action: 'none', reason: 'Orden de reactivación ya pendiente.' };
      }
      return { serviceStatus: 'PENDING_REACTIVATION', action: 'create_reactivation', reason: 'Saldo regularizado: procede reactivación.' };
    }

    if (!regularized && partialPaid && policy.reactivateOnPartialPayment && policy.autoReactivate) {
      if (hasOpenReactivationOrder) {
        return { serviceStatus: 'PENDING_REACTIVATION', action: 'none', reason: 'Orden de reactivación ya pendiente.' };
      }
      return { serviceStatus: 'PENDING_REACTIVATION', action: 'create_reactivation', reason: 'Pago parcial aplicado (reactivate_on_partial_payment=true).' };
    }

    return { serviceStatus: 'SUSPENDED', action: 'none', reason: 'Suspendido: saldo pendiente.' };
  }

  return { serviceStatus: 'ACTIVE', action: 'none', reason: 'Cliente no serviceable (lead/baja).' };
}

// ── Infraestructura (async) ───────────────────────────────────────────
const SERVICEABLE = new Set(['active', 'suspended']);

// ── Tenant de una evaluación CON EFECTOS ──────────────────────────────
//
// El motor escribe órdenes, eventos y —desde B1— bloqueos financieros. Todos
// son filas tenant-scoped, así que una evaluación sin identidad de tenant no
// puede seguir cayendo en silencio a `tenant-default`: mezclaría WISPs.
//
// El fallback histórico sobrevive SOLO en el modo hermético single-WISP
// (todo en memoria, sin multi-tenant y sin runtime endurecido), que es donde
// nació. En cuanto hay aislamiento real que respetar, falla cerrado.
export const requiresExplicitTenantScope = (): boolean =>
  isHardenedRuntimeNow()
  || isMultiTenantEnabled()
  || isDomainOnDb('suspension')
  || isDomainOnDb('customers')
  || isDomainOnDb('billing');

export function resolveEvaluationTenantId(
  tenantId: string | undefined,
  caller: string,
): string {
  const scoped = (tenantId || '').trim();
  if (scoped) return scoped;
  if (requiresExplicitTenantScope()) {
    throw new Error(
      `${caller}: tenantId es obligatorio cuando hay aislamiento por tenant activo `
      + '(multi-tenant, runtime endurecido o dominios en DB). Una evaluación con efectos '
      + 'no puede asumir tenant-default.',
    );
  }
  return DEFAULT_TENANT_ID;
}

const groupInvoices = (invoices: Invoice[]): Map<string, Invoice[]> => {
  const m = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const arr = m.get(inv.clientId) ?? [];
    arr.push(inv);
    m.set(inv.clientId, arr);
  }
  return m;
};

/** Núcleo de evaluación con efectos para UN cliente ya cargado. */
async function applyEvaluation(
  repo: SuspensionRepository,
  customer: CustomerLite,
  invoices: Invoice[],
  policy: SuspensionPolicyV2,
  actorId: string | undefined,
  now: number,
  tenantId: string,
): Promise<EvaluationResult> {
  const iso = new Date(now).toISOString();
  const { billingStatus, worstInvoiceId, partialPaid } = aggregateBillingStatus(invoices, policy, now);

  const prev = await repo.getState(customer.id);
  const previousServiceStatus = prev ? prev.serviceStatus : null;

  if (!SERVICEABLE.has(customer.status)) {
    await repo.upsertState({
      customerId: customer.id,
      customerName: customer.name,
      serviceStatus: prev?.serviceStatus ?? 'ACTIVE',
      billingStatus,
      networkStatus: customer.status,
      lastEvaluatedAt: iso,
      lastSuspensionAt: prev?.lastSuspensionAt,
      lastReactivationAt: prev?.lastReactivationAt,
      currentReason: 'Cliente no serviceable (lead/baja).',
      updatedAt: iso,
    });
    return {
      customerId: customer.id, customerName: customer.name, previousServiceStatus,
      serviceStatus: prev?.serviceStatus ?? 'ACTIVE', billingStatus, networkStatus: customer.status,
      changed: false, action: 'none', reason: 'Cliente no serviceable (lead/baja).',
    };
  }

  // Las órdenes abiertas se leen SIEMPRE dentro del tenant: dos WISPs pueden
  // compartir el mismo customerId y la orden de uno no debe suprimir ni
  // cancelar la del otro.
  const open = await repo.openOrders(customer.id, undefined, tenantId);
  const decision = decideServiceStatus({
    networkStatus: customer.status,
    billingStatus,
    partialPaid,
    hasOpenSuspensionOrder: open.some((o) => o.orderType === 'suspension'),
    hasOpenReactivationOrder: open.some((o) => o.orderType === 'reactivation'),
    policy,
  });

  let orderId: string | undefined;
  // Orden del motor que debe respaldar el bloqueo financiero de este cliente.
  let financialEvidenceOrder: SuspensionOrder | undefined;
  if (decision.action === 'create_suspension') {
    await repo.cancelOpenOrders(customer.id, 'reactivation', 'Reemplazada por nueva orden de suspensión.', actorId, tenantId);
    const order = await repo.createOrder({ customerId: customer.id, tenantId, invoiceId: worstInvoiceId, orderType: 'suspension', source: 'engine', reason: decision.reason });
    orderId = order.id;
    financialEvidenceOrder = order;
    await repo.recordEvent({ customerId: customer.id, tenantId, invoiceId: worstInvoiceId, eventType: 'suspension_order_created', reason: decision.reason, automatic: true, actorId, metadata: { orderId: order.id, billingStatus } });
  } else if (decision.action === 'create_reactivation') {
    await repo.cancelOpenOrders(customer.id, 'suspension', 'Reemplazada por nueva orden de reactivación.', actorId, tenantId);
    const order = await repo.createOrder({ customerId: customer.id, tenantId, invoiceId: worstInvoiceId, orderType: 'reactivation', source: 'engine', reason: decision.reason });
    orderId = order.id;
    await repo.recordEvent({ customerId: customer.id, tenantId, invoiceId: worstInvoiceId, eventType: 'reactivation_order_created', reason: decision.reason, automatic: true, actorId, metadata: { orderId: order.id, billingStatus } });
  } else if (billingStatus === 'DELINQUENT') {
    // Reconciliación (B1): la orden de corte ya existe pero su bloqueo pudo no
    // haberse persistido (fallo parcial en una evaluación anterior).
    //
    //   1. Orden aún abierta: `decideServiceStatus` devuelve 'none', así que
    //      sin esta rama el reintento nunca podría reparar el bloqueo.
    //   2. Orden ya cerrada por el worker: se reconcilia SÓLO cuando la
    //      asociación es inequívoca — una única orden del motor ligada a la
    //      misma factura que hoy sigue impagada. No es un backfill: un
    //      suspendido sin orden del motor no obtiene evidencia por aquí.
    financialEvidenceOrder = findEngineFinancialOrder(open, tenantId, customer.id);
    if (!financialEvidenceOrder) {
      const history = await repo.listOrders({ customerId: customer.id, tenantId });
      financialEvidenceOrder = findDeterministicEngineFinancialOrder(
        history,
        tenantId,
        customer.id,
        worstInvoiceId,
      );
    }
  }

  // Convergencia idempotente: create-or-return por (tenant, evidencia). Se
  // ejecuta después de que la orden sea durable, porque la orden ES la
  // evidencia. Si falla, la evaluación falla de forma visible y la orden
  // queda abierta para que el siguiente intento reconcilie.
  if (financialEvidenceOrder) {
    await ensureEngineFinancialBlock(repo, {
      tenantId,
      customerId: customer.id,
      order: financialEvidenceOrder,
      billingStatus,
      graceDays: policy.graceDays,
    });
  }

  const changed = previousServiceStatus !== decision.serviceStatus;
  if (changed) {
    await repo.recordEvent({
      customerId: customer.id, tenantId, invoiceId: worstInvoiceId, eventType: 'state_changed',
      reason: `${previousServiceStatus ?? 'NUEVO'} -> ${decision.serviceStatus}: ${decision.reason}`,
      automatic: true, actorId, metadata: { from: previousServiceStatus, to: decision.serviceStatus, billingStatus },
    });
  }

  await repo.upsertState({
    customerId: customer.id,
    customerName: customer.name,
    serviceStatus: decision.serviceStatus,
    billingStatus,
    networkStatus: customer.status,
    lastEvaluatedAt: iso,
    lastSuspensionAt: decision.action === 'create_suspension' ? iso : prev?.lastSuspensionAt,
    lastReactivationAt: decision.action === 'create_reactivation' ? iso : prev?.lastReactivationAt,
    currentReason: decision.reason,
    updatedAt: iso,
  });

  return {
    customerId: customer.id, customerName: customer.name, previousServiceStatus,
    serviceStatus: decision.serviceStatus, billingStatus, networkStatus: customer.status,
    changed, action: decision.action, orderId, reason: decision.reason, invoiceId: worstInvoiceId,
  };
}

// ── API pública (async) ───────────────────────────────────────────────

/** Estado de cobranza agregado de un cliente (carga sus facturas reales). */
export async function evaluateBillingState(
  customerId: string,
  policy?: SuspensionPolicyV2,
  now = Date.now(),
  tenantId?: string,
) {
  const { repo, data } = getSuspensionService();
  const pol = policy ?? (await repo.getPolicy());
  const invoices = (await data.loadInvoices(tenantId)).filter((i) => i.clientId === customerId);
  return aggregateBillingStatus(invoices, pol, now);
}

export async function evaluateCustomerById(
  customerId: string,
  actorId?: string,
  tenantId?: string,
): Promise<EvaluationResult | null> {
  // El tenant se resuelve ANTES de construir el service: una evaluación sin
  // scope debe fallar por su propia causa, no por un error de configuración.
  const scopedTenantId = resolveEvaluationTenantId(tenantId, 'evaluateCustomerById');
  const { repo, data } = getSuspensionService();
  const customer = await data.getCustomer(customerId, scopedTenantId);
  if (!customer) return null;
  const policy = await repo.getPolicy();
  const invoices = (await data.loadInvoices(scopedTenantId)).filter((i) => i.clientId === customerId);
  return applyEvaluation(repo, customer, invoices, policy, actorId, Date.now(), scopedTenantId);
}

export async function evaluateAllCustomers(
  actorId?: string,
  tenantId?: string,
): Promise<EvaluationResult[]> {
  const scopedTenantId = resolveEvaluationTenantId(tenantId, 'evaluateAllCustomers');
  const { repo, data } = getSuspensionService();
  const policy = await repo.getPolicy();
  const now = Date.now();
  const [customers, invoices] = await Promise.all([
    data.loadCustomers(scopedTenantId),
    data.loadInvoices(scopedTenantId),
  ]);
  const byCustomer = groupInvoices(invoices);
  const results: EvaluationResult[] = [];
  for (const customer of customers) {
    results.push(await applyEvaluation(repo, customer, byCustomer.get(customer.id) ?? [], policy, actorId, now, scopedTenantId));
  }
  return results;
}

/** Vista de cobranza por cliente (read-only, sin efectos) para la UI. */
export async function customerServiceView(tenantId?: string) {
  const { repo, data } = getSuspensionService();
  const policy = await repo.getPolicy();
  const now = Date.now();
  const [customers, invoices, states, orders] = await Promise.all([
    data.loadCustomers(tenantId), data.loadInvoices(tenantId), repo.listStates(), repo.listOrders(),
  ]);
  const byCustomer = groupInvoices(invoices);
  const openByCustomer = groupOpenOrders(orders);
  const stateById = new Map(states.map((s) => [s.customerId, s]));

  return customers
    .filter((c) => c.status === 'active' || c.status === 'suspended')
    .map((c) => {
      const { billingStatus, worstInvoiceId, partialPaid } = aggregateBillingStatus(byCustomer.get(c.id) ?? [], policy, now);
      const open = openByCustomer.get(c.id) ?? [];
      const decision = decideServiceStatus({
        networkStatus: c.status, billingStatus, partialPaid,
        hasOpenSuspensionOrder: open.some((o) => o.orderType === 'suspension'),
        hasOpenReactivationOrder: open.some((o) => o.orderType === 'reactivation'),
        policy,
      });
      const stored = stateById.get(c.id);
      return {
        customerId: c.id, customerName: c.name, serviceStatus: decision.serviceStatus,
        billingStatus, networkStatus: c.status, reason: decision.reason, worstInvoiceId,
        lastEvaluatedAt: stored?.lastEvaluatedAt, lastSuspensionAt: stored?.lastSuspensionAt,
        lastReactivationAt: stored?.lastReactivationAt,
      };
    });
}

/** KPIs de suspensión para el dashboard (read-only, sin efectos). */
export async function suspensionKpis(now = Date.now(), tenantId?: string) {
  const { repo, data } = getSuspensionService();
  const policy = await repo.getPolicy();
  const today = new Date(now).toISOString().substring(0, 10);
  const [customers, invoices, orders] = await Promise.all([
    data.loadCustomers(tenantId), data.loadInvoices(tenantId), repo.listOrders(),
  ]);
  const byCustomer = groupInvoices(invoices);
  const openByCustomer = groupOpenOrders(orders);

  let delinquent = 0, overdue = 0, active = 0, warning = 0, pendingSuspension = 0, suspended = 0, pendingReactivation = 0;
  for (const c of customers) {
    if (c.status !== 'active' && c.status !== 'suspended') continue;
    const { billingStatus, partialPaid } = aggregateBillingStatus(byCustomer.get(c.id) ?? [], policy, now);
    if (billingStatus === 'DELINQUENT') delinquent += 1;
    if (billingStatus === 'OVERDUE') overdue += 1;
    const open = openByCustomer.get(c.id) ?? [];
    const decision = decideServiceStatus({
      networkStatus: c.status, billingStatus, partialPaid,
      hasOpenSuspensionOrder: open.some((o) => o.orderType === 'suspension'),
      hasOpenReactivationOrder: open.some((o) => o.orderType === 'reactivation'),
      policy,
    });
    switch (decision.serviceStatus) {
      case 'ACTIVE': active += 1; break;
      case 'WARNING': warning += 1; break;
      case 'PENDING_SUSPENSION': pendingSuspension += 1; break;
      case 'SUSPENDED': suspended += 1; break;
      case 'PENDING_REACTIVATION': pendingReactivation += 1; break;
    }
  }

  const suspendedToday = orders.filter((o) => o.orderType === 'suspension' && o.createdAt.substring(0, 10) === today).length;
  const reactivatedToday = orders.filter((o) => o.orderType === 'reactivation' && o.createdAt.substring(0, 10) === today).length;

  return {
    suspendedToday,
    reactivatedToday,
    delinquent,                 // contrato 4.5.1
    morosos: delinquent + overdue, // compat hacia atrás
    pendingSuspension,
    pendingReactivation,
    active,
    warning,
    suspended,
  };
}

function groupOpenOrders(orders: SuspensionOrder[]): Map<string, SuspensionOrder[]> {
  const m = new Map<string, SuspensionOrder[]>();
  for (const o of orders) {
    if (o.status !== 'PENDING' && o.status !== 'QUEUED') continue;
    const arr = m.get(o.customerId) ?? [];
    arr.push(o);
    m.set(o.customerId, arr);
  }
  return m;
}
