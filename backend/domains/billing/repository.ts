// ====================================================================
// Repository del dominio Billing.
//
// Contrato `BillingRepository` + dos implementaciones:
//   - StoreBillingRepository    → store en memoria (mock, USE_DB_BILLING=false).
//   - SupabaseBillingRepository → PostgreSQL (USE_DB_BILLING=true).
//
// El contrato de API v1 no cambia en ningún modo: ambos devuelven
// EnrichedInvoice (Invoice + paidAmount + pendingAmount).
//
// Nota de alcance: la reactivación automática de cliente suspendido al
// pagar vive en routes.ts (efecto cruzado con Suspension). El repository
// solo gestiona la entidad Invoice + sus pagos.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { Invoice } from '../../../src/types';
import { store } from '../../state/store';
import { logger } from '../../common/logger';
import {
  BadRequestError,
  IdempotencyConflictError,
  ServiceUnavailableError,
} from '../../common/errors';
import {
  AllocationEntry,
  EnrichedInvoice,
  InvoiceItem,
  InvoiceItemRow,
  InvoiceRow,
  PaymentApplicationRow,
  buildInvoiceInsertRow,
  buildItemInsertRow,
  rowsToAllocations,
  rowsToEnrichedInvoice,
} from './mappers';

// Re-exportar para que service.ts y tests puedan importar desde un solo módulo
export type { AllocationEntry, EnrichedInvoice };

// ── Tipos públicos del repository ─────────────────────────────────────

export interface AccountStateResult {
  invoice: EnrichedInvoice;
  allocations: AllocationEntry[];
}

export interface AccountSummaryResult {
  totalInvoiced: number;
  totalCollected: number;
  totalPending: number;
  overdueCount: number;
  paidCount: number;
  unpaidCount: number;
  invoicesCount: number;
}

export interface RevenueReportResult {
  generatedAt: string;
  byMethod: { method: string; amount: number }[];
  topPendingInvoices: EnrichedInvoice[];
}

export interface InvoiceCreateInput {
  clientId: string;
  clientName: string;
  amount: number;
  dueDateStr: string;
  items: InvoiceItem[];
  tenantId?: string;
}

export interface InvoiceUpdateInput {
  amount?: number;
  dueDateStr?: string;
  items?: InvoiceItem[];
  status?: Invoice['status'];
}

export interface PaymentRecordInput {
  amount: number;             // pesos (ya validado por el service)
  method: string;
  transactionId: string;
}

// ── Pago de webhook: atómico, idempotente y condicionado al claim ──────
//
// El check en memoria sobre `invoice.payments[].transactionId` NO es el gate
// de unicidad: entre la lectura y el `recordPayment` cabe otro owner. Esta
// operación mueve la decisión al mismo lugar donde vive el ledger, de forma
// que crear el pago, garantizar su aplicación y recalcular la factura ocurren
// bajo el mismo lock, con el claim validado antes de escribir nada.

export interface WebhookPaymentInput {
  invoiceId: string;
  tenantId: string;
  amount: number;
  method: string;
  /** Proveedor que asignó transactionId/orderId. */
  provider: string;
  transactionId: string;
  /** Identidad tenant-scoped del pago; estable entre owners y reentregas. */
  idempotencyKey: string;
  /** Claim vigente; sin él la operación no escribe. */
  claim: { eventId: string; claimToken: string };
}

export type WebhookPaymentOutcome = 'created' | 'existing' | 'ownership_lost';

export interface WebhookPaymentResult {
  outcome: WebhookPaymentOutcome;
  /** Factura resultante; `null` cuando el claim se perdió y no se escribió. */
  invoice: EnrichedInvoice | null;
  /** Transición calculada dentro del lock; nunca se deriva del reload posterior. */
  wasSettledBefore: boolean;
  isSettledAfter: boolean;
  /** Identidad durable del único cargo autorizado a iniciar la raíz. */
  settlementWinner: boolean;
  /** Internal ledger identity shared by every delivery of the same charge. */
  canonicalPaymentId: string | null;
}

export const BILLING_IDEMPOTENCY_SCOPE = 'payments';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

/**
 * Normaliza el importe del webhook al mismo dominio que acepta la RPC
 * (`INTEGER` de centavos). Validar antes de consultar adapters evita que
 * NaN/Infinity, importes no positivos, sub-centavo u overflow produzcan
 * efectos distintos entre Store y PostgreSQL.
 */
export const webhookPaymentAmountCents = (amount: number): number => {
  const cents = Math.round(amount * 100);
  const normalizedAmount = cents / 100;
  const centTolerance = Number.EPSILON * Math.max(1, Math.abs(amount)) * 4;
  if (
    !Number.isFinite(amount)
    || amount <= 0
    || !Number.isSafeInteger(cents)
    || cents <= 0
    || cents > POSTGRES_INTEGER_MAX
    || Math.abs(amount - normalizedAmount) > centTolerance
  ) {
    throw new BadRequestError(
      'El importe del webhook debe ser finito, positivo y representable en centavos.',
      'INVALID_AMOUNT',
    );
  }
  return cents;
};

// ── Contrato ──────────────────────────────────────────────────────────

export interface BillingRepository {
  listInvoices(tenantId?: string): Promise<EnrichedInvoice[]>;
  findInvoiceById(id: string, tenantId?: string): Promise<EnrichedInvoice | null>;
  getAccountState(invoiceId: string, tenantId?: string): Promise<AccountStateResult | null>;
  getAccountSummary(tenantId?: string): Promise<AccountSummaryResult>;
  getRevenueReport(tenantId?: string): Promise<RevenueReportResult>;
  createInvoice(input: InvoiceCreateInput): Promise<EnrichedInvoice>;
  updateInvoice(id: string, input: InvoiceUpdateInput, tenantId?: string): Promise<EnrichedInvoice | null>;
  cancelInvoice(id: string, reason?: string, tenantId?: string): Promise<EnrichedInvoice | null>;
  recordPayment(invoiceId: string, input: PaymentRecordInput, tenantId?: string): Promise<EnrichedInvoice>;
  /**
   * Ruta exclusiva del webhook: valida el claim, crea o recupera el pago por
   * identidad y deja factura + aplicación consistentes en una sola operación.
   * Los pagos manuales siguen usando `recordPayment` sin clave.
   */
  applyWebhookPayment(input: WebhookPaymentInput): Promise<WebhookPaymentResult>;
  generateInvoiceId(): Promise<string>;
}

// ── Helpers compartidos ───────────────────────────────────────────────

const roundMoney = (v: number) => Math.round(v * 100) / 100;

const invoicePaidAmount = (inv: Invoice): number =>
  roundMoney(inv.payments.reduce((s, p) => s + Number(p.amount || 0), 0));

const invoicePendingAmount = (inv: Invoice): number =>
  roundMoney(Math.max(inv.amount - invoicePaidAmount(inv), 0));

const syncStatus = (inv: Invoice): void => {
  // 'canceled' es terminal: nunca se recalcula a partir de pagos/vencimiento.
  if (inv.status === 'canceled') {
    inv.cfdiStatus = 'canceled';
    return;
  }
  const pending = invoicePendingAmount(inv);
  const pastDue = new Date(inv.dueDateStr).getTime() < Date.now();
  if (pending <= 0) {
    inv.status = 'paid';
    inv.cfdiStatus = 'generated';
    if (!inv.cfdiUuid) {
      inv.cfdiUuid =
        '4F17A9B9-' +
        Math.floor(Math.random() * 9000 + 1000) +
        '-4EF2-BD44-FFBBAA123' +
        Math.floor(Math.random() * 90 + 10);
    }
  } else {
    inv.status = pastDue ? 'overdue' : 'unpaid';
    if (inv.cfdiStatus === 'generated' && pending > 0) inv.cfdiStatus = 'pending';
  }
};

const enrich = (inv: Invoice): EnrichedInvoice => ({
  ...inv,
  items: inv.items.map((item) => ({ ...item })),
  payments: inv.payments.map((payment) => ({ ...payment })),
  paidAmount: invoicePaidAmount(inv),
  pendingAmount: invoicePendingAmount(inv),
});

// ────────────────────────────────────────────────────────────────────
// IMPLEMENTACIÓN 1 — Store en memoria (idéntico al comportamiento actual)
// ────────────────────────────────────────────────────────────────────
export class StoreBillingRepository implements BillingRepository {
  async listInvoices(tenantId?: string): Promise<EnrichedInvoice[]> {
    store.INVOICES.forEach(syncStatus);
    return store.INVOICES
      .filter((i) => !tenantId || (i.tenantId || 'tenant-default') === tenantId)
      .map(enrich);
  }

  async findInvoiceById(id: string, tenantId?: string): Promise<EnrichedInvoice | null> {
    const inv = store.INVOICES.find((i) => {
      if (i.id !== id) return false;
      if (tenantId && (i.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    if (!inv) return null;
    syncStatus(inv);
    return enrich(inv);
  }

  async getAccountState(invoiceId: string, tenantId?: string): Promise<AccountStateResult | null> {
    const inv = store.INVOICES.find((i) => {
      if (i.id !== invoiceId) return false;
      if (tenantId && (i.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    if (!inv) return null;
    syncStatus(inv);
    const allocations = store.PAYMENT_ALLOCATIONS
      .filter((a) => a.invoiceId === invoiceId)
      .map((a) => ({
        id: a.id,
        invoiceId: a.invoiceId,
        amount: a.amount,
        method: a.method,
        paymentDate: a.paymentDate,
        transactionId: a.transactionId,
        remainingAfterPayment: a.remainingAfterPayment,
      }));
    return { invoice: enrich(inv), allocations };
  }

  async getAccountSummary(tenantId?: string): Promise<AccountSummaryResult> {
    store.INVOICES.forEach(syncStatus);
    const scoped = store.INVOICES.filter(
      (i) => !tenantId || (i.tenantId || 'tenant-default') === tenantId,
    );
    return scoped.reduce(
      (acc, inv) => {
        if (inv.status === 'canceled') return acc; // canceladas no cuentan en cobranza
        const paid = invoicePaidAmount(inv);
        const pending = invoicePendingAmount(inv);
        acc.totalInvoiced += inv.amount;
        acc.totalCollected += paid;
        acc.totalPending += pending;
        if (inv.status === 'overdue') acc.overdueCount += 1;
        if (inv.status === 'paid') acc.paidCount += 1;
        if (inv.status === 'unpaid') acc.unpaidCount += 1;
        return acc;
      },
      {
        totalInvoiced: 0, totalCollected: 0, totalPending: 0,
        overdueCount: 0, paidCount: 0, unpaidCount: 0,
        invoicesCount: scoped.length,
      },
    );
  }

  async getRevenueReport(tenantId?: string): Promise<RevenueReportResult> {
    store.INVOICES.forEach(syncStatus);
    const scoped = store.INVOICES.filter(
      (i) => !tenantId || (i.tenantId || 'tenant-default') === tenantId,
    );
    const byMethod = new Map<string, number>();
    for (const inv of scoped) {
      for (const p of inv.payments) {
        const m = p.method || 'Otro';
        byMethod.set(m, roundMoney((byMethod.get(m) || 0) + Number(p.amount || 0)));
      }
    }
    const topPending = scoped
      .map(enrich)
      .filter((i) => i.pendingAmount > 0)
      .sort((a, b) => b.pendingAmount - a.pendingAmount)
      .slice(0, 10);
    return {
      generatedAt: new Date().toISOString(),
      byMethod: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount })),
      topPendingInvoices: topPending,
    };
  }

  async createInvoice(input: InvoiceCreateInput): Promise<EnrichedInvoice> {
    const id = await this.generateInvoiceId();
    const today = new Date().toISOString().substring(0, 10);
    const inv: Invoice = {
      id,
      clientId: input.clientId,
      clientName: input.clientName,
      amount: input.amount,
      dateStr: today,
      dueDateStr: input.dueDateStr,
      status: 'unpaid',
      cfdiStatus: 'pending',
      items: input.items,
      payments: [],
      tenantId: input.tenantId || 'tenant-default',
    };
    store.INVOICES.unshift(inv);
    return enrich(inv);
  }

  async updateInvoice(id: string, input: InvoiceUpdateInput, tenantId?: string): Promise<EnrichedInvoice | null> {
    const inv = store.INVOICES.find((i) => {
      if (i.id !== id) return false;
      if (tenantId && (i.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    if (!inv) return null;
    if (input.amount !== undefined) inv.amount = input.amount;
    if (input.dueDateStr !== undefined) inv.dueDateStr = input.dueDateStr;
    if (input.items !== undefined) inv.items = input.items;
    if (input.status !== undefined) inv.status = input.status;
    syncStatus(inv);
    return enrich(inv);
  }

  async cancelInvoice(id: string, _reason?: string, tenantId?: string): Promise<EnrichedInvoice | null> {
    const inv = store.INVOICES.find((i) => {
      if (i.id !== id) return false;
      if (tenantId && (i.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    if (!inv) return null;
    inv.status = 'canceled';
    inv.cfdiStatus = 'canceled';
    return enrich(inv);
  }

  async recordPayment(
    invoiceId: string,
    input: PaymentRecordInput,
    tenantId?: string,
  ): Promise<EnrichedInvoice> {
    const inv = store.INVOICES.find((i) => {
      if (i.id !== invoiceId) return false;
      if (tenantId && (i.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    if (!inv) throw new Error('Invoice not found');
    inv.payments.push({
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      amount: input.amount,
      method: input.method,
      transactionId: input.transactionId,
    });
    syncStatus(inv);
    const pendingAfter = invoicePendingAmount(inv);
    store.PAYMENT_ALLOCATIONS.unshift({
      id: store.getUniquePaymentAllocationId(),
      invoiceId,
      amount: input.amount,
      method: input.method,
      paymentDate: new Date().toISOString(),
      transactionId: input.transactionId,
      remainingAfterPayment: pendingAfter,
    });
    return enrich(inv);
  }

  async applyWebhookPayment(input: WebhookPaymentInput): Promise<WebhookPaymentResult> {
    webhookPaymentAmountCents(input.amount);
    // Toda la secuencia es síncrona tras esta línea: sin `await` intermedio el
    // bucle de eventos no puede intercalar a otro owner, que es la propiedad
    // que en Supabase da la transacción. Payments y Billing comparten Store
    // porque el capability gate rechaza los tuples mixtos.
    const invoice = store.INVOICES.find(
      (i) => i.id === input.invoiceId && (i.tenantId || 'tenant-default') === input.tenantId,
    );
    if (!invoice) throw new Error(`Invoice not found: ${input.invoiceId}`);

    const event = store.PAYMENT_EVENTS.find(
      (e) => e.id === input.claim.eventId && (e.tenantId || 'tenant-default') === input.tenantId,
    );
    if (!event) throw new Error(`applyWebhookPayment: evento de pago inexistente (${input.claim.eventId})`);
    // Ownership primero: un owner vencido no puede tocar el ledger.
    if (event.processed || event.claimToken !== input.claim.claimToken) {
      return {
        outcome: 'ownership_lost', invoice: null,
        wasSettledBefore: false, isSettledAfter: false, settlementWinner: false,
        canonicalPaymentId: null,
      };
    }

    const existingByCharge = store.PAYMENT_ALLOCATIONS.find(
      (a) =>
        (a.tenantId || 'tenant-default') === input.tenantId
        && a.provider === input.provider
        && a.transactionId === input.transactionId,
    );
    const existingByKey = store.PAYMENT_ALLOCATIONS.find(
      (a) =>
        (a.tenantId || 'tenant-default') === input.tenantId
        && a.idempotencyKey === input.idempotencyKey,
    );
    if (existingByKey && existingByCharge && existingByKey.id !== existingByCharge.id) {
      throw new IdempotencyConflictError(BILLING_IDEMPOTENCY_SCOPE, input.idempotencyKey);
    }
    const existing = existingByCharge ?? existingByKey;
    if (existing) {
      if (
        existing.invoiceId !== input.invoiceId
        || existing.amount !== input.amount
        || existing.method !== input.method
        || existing.provider !== input.provider
        || (existing.transactionId ?? null) !== (input.transactionId ?? null)
      ) {
        throw new IdempotencyConflictError(BILLING_IDEMPOTENCY_SCOPE, input.idempotencyKey);
      }
      syncStatus(invoice);
      event.webhookPaymentId = existing.id;
      const settled = invoice.status === 'paid' && invoicePendingAmount(invoice) <= 0;
      return {
        outcome: 'existing',
        invoice: enrich(invoice),
        wasSettledBefore: settled,
        isSettledAfter: settled,
        settlementWinner: existing.settlementWinner === true,
        canonicalPaymentId: existing.id,
      };
    }

    const wasSettledBefore = invoice.status === 'paid' && invoicePendingAmount(invoice) <= 0;
    invoice.payments.push({
      date: new Date().toISOString().replace('T', ' ').substring(0, 16),
      amount: input.amount,
      method: input.method,
      provider: input.provider,
      transactionId: input.transactionId,
    });
    syncStatus(invoice);
    const isSettledAfter = invoice.status === 'paid' && invoicePendingAmount(invoice) <= 0;
    const settlementWinner = !wasSettledBefore && isSettledAfter;
    const canonicalPaymentId = store.getUniquePaymentAllocationId();
    store.PAYMENT_ALLOCATIONS.unshift({
      id: canonicalPaymentId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      paymentDate: new Date().toISOString(),
      transactionId: input.transactionId,
      provider: input.provider,
      remainingAfterPayment: invoicePendingAmount(invoice),
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
      settlementWinner,
    });
    event.webhookPaymentId = canonicalPaymentId;
    return {
      outcome: 'created', invoice: enrich(invoice), wasSettledBefore, isSettledAfter,
      settlementWinner, canonicalPaymentId,
    };
  }

  async generateInvoiceId(): Promise<string> {
    return store.getUniqueInvoiceId();
  }
}

// ────────────────────────────────────────────────────────────────────
// IMPLEMENTACIÓN 2 — Supabase (USE_DB_BILLING=true)
// ────────────────────────────────────────────────────────────────────
export class SupabaseBillingRepository implements BillingRepository {
  constructor(private readonly client: SupabaseClient) {}

  // ── Helpers de carga ───────────────────────────────────────────────

  private async loadItems(invoiceIds: string[]): Promise<Map<string, InvoiceItemRow[]>> {
    if (invoiceIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('invoice_items')
      .select('id, invoice_id, description, price, qty, unit_price_cents, discount_cents, tax_rate, sort_order')
      .in('invoice_id', invoiceIds);
    if (error) throw new Error(`invoice_items: ${error.message}`);
    const map = new Map<string, InvoiceItemRow[]>();
    for (const row of (data || []) as InvoiceItemRow[]) {
      if (!map.has(row.invoice_id)) map.set(row.invoice_id, []);
      map.get(row.invoice_id)!.push(row);
    }
    return map;
  }

  private async loadPaymentApps(invoiceIds: string[]): Promise<Map<string, PaymentApplicationRow[]>> {
    if (invoiceIds.length === 0) return new Map();
    const { data, error } = await this.client
      .from('payment_applications')
      .select('id, payment_id, invoice_id, applied_cents, applied_at, applied_by, payments(id, method, provider, transaction_id, amount_cents, payment_date, status)')
      .in('invoice_id', invoiceIds)
      .order('applied_at', { ascending: true });
    if (error) throw new Error(`payment_applications: ${error.message}`);
    const map = new Map<string, PaymentApplicationRow[]>();
    for (const row of (data || []) as unknown as PaymentApplicationRow[]) {
      if (!map.has(row.invoice_id)) map.set(row.invoice_id, []);
      map.get(row.invoice_id)!.push(row);
    }
    return map;
  }

  private buildEnriched(
    invoices: InvoiceRow[],
    itemMap: Map<string, InvoiceItemRow[]>,
    appMap: Map<string, PaymentApplicationRow[]>,
  ): EnrichedInvoice[] {
    return invoices.map((row) =>
      rowsToEnrichedInvoice(
        row,
        itemMap.get(row.id) ?? [],
        appMap.get(row.id) ?? [],
      ),
    );
  }

  // ── Métodos públicos ───────────────────────────────────────────────

  async listInvoices(tenantId?: string): Promise<EnrichedInvoice[]> {
    let query = this.client.from('invoices').select('*').order('created_at', { ascending: false });
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query;
    if (error) throw new Error(`invoices list: ${error.message}`);
    const rows = (data || []) as InvoiceRow[];
    const ids = rows.map((r) => r.id);
    const [itemMap, appMap] = await Promise.all([
      this.loadItems(ids),
      this.loadPaymentApps(ids),
    ]);
    return this.buildEnriched(rows, itemMap, appMap);
  }

  async findInvoiceById(id: string, tenantId?: string): Promise<EnrichedInvoice | null> {
    let query = this.client.from('invoices').select('*').eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`findInvoiceById: ${error.message}`);
    if (!data) return null;
    const row = data as InvoiceRow;
    const [itemMap, appMap] = await Promise.all([
      this.loadItems([id]),
      this.loadPaymentApps([id]),
    ]);
    return rowsToEnrichedInvoice(row, itemMap.get(id) ?? [], appMap.get(id) ?? []);
  }

  async getAccountState(invoiceId: string, tenantId?: string): Promise<AccountStateResult | null> {
    const invoice = await this.findInvoiceById(invoiceId, tenantId);
    if (!invoice) return null;
    const appMap = await this.loadPaymentApps([invoiceId]);
    const apps = appMap.get(invoiceId) ?? [];
    const allocations = rowsToAllocations(apps, invoice.amount);
    return { invoice, allocations };
  }

  async getAccountSummary(tenantId?: string): Promise<AccountSummaryResult> {
    const invoices = await this.listInvoices(tenantId);
    return invoices.reduce(
      (acc, inv) => {
        if (inv.status === 'canceled') return acc; // canceladas no cuentan en cobranza
        acc.totalInvoiced += inv.amount;
        acc.totalCollected += inv.paidAmount;
        acc.totalPending += inv.pendingAmount;
        if (inv.status === 'overdue') acc.overdueCount += 1;
        if (inv.status === 'paid') acc.paidCount += 1;
        if (inv.status === 'unpaid') acc.unpaidCount += 1;
        return acc;
      },
      {
        totalInvoiced: 0, totalCollected: 0, totalPending: 0,
        overdueCount: 0, paidCount: 0, unpaidCount: 0,
        invoicesCount: invoices.length,
      },
    );
  }

  async getRevenueReport(tenantId?: string): Promise<RevenueReportResult> {
    const invoices = await this.listInvoices(tenantId);
    const byMethod = new Map<string, number>();
    for (const inv of invoices) {
      for (const p of inv.payments) {
        const m = p.method || 'Otro';
        byMethod.set(m, roundMoney((byMethod.get(m) || 0) + p.amount));
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      byMethod: Array.from(byMethod.entries()).map(([method, amount]) => ({ method, amount })),
      topPendingInvoices: invoices
        .filter((i) => i.pendingAmount > 0)
        .sort((a, b) => b.pendingAmount - a.pendingAmount)
        .slice(0, 10),
    };
  }

  async createInvoice(input: InvoiceCreateInput): Promise<EnrichedInvoice> {
    const id = await this.generateInvoiceId();
    const invoiceRow = buildInvoiceInsertRow(
      id, input.clientId, input.clientName, input.amount, input.dueDateStr,
      input.tenantId || 'tenant-default',
    );

    let { error: invErr } = await this.client.from('invoices').insert(invoiceRow);
    if (invErr && /tenant_id/i.test(invErr.message || '')) {
      const { tenant_id: _omit, ...without } = invoiceRow;
      ({ error: invErr } = await this.client.from('invoices').insert(without));
    }
    if (invErr) throw new Error(`create invoice: ${invErr.message}`);

    if (input.items.length > 0) {
      const itemRows = input.items.map((item, i) =>
        buildItemInsertRow(`item-${id}-${i + 1}`, id, item, i),
      );
      const { error: itemErr } = await this.client.from('invoice_items').insert(itemRows);
      if (itemErr) throw new Error(`create invoice_items: ${itemErr.message}`);
    }

    const created = await this.findInvoiceById(id, input.tenantId);
    return created!;
  }

  async updateInvoice(
    id: string,
    input: InvoiceUpdateInput,
    tenantId?: string,
  ): Promise<EnrichedInvoice | null> {
    const existing = await this.findInvoiceById(id, tenantId);
    if (!existing) return null;

    const patch: Record<string, unknown> = {};
    if (input.amount !== undefined) {
      patch.amount = input.amount;
      patch.total_cents = Math.round(input.amount * 100);
      patch.subtotal_cents = patch.total_cents;
    }
    if (input.dueDateStr !== undefined) patch.due_date = input.dueDateStr;
    if (input.status !== undefined) patch.status = input.status;

    if (Object.keys(patch).length > 0) {
      let q = this.client.from('invoices').update(patch).eq('id', id);
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { error } = await q;
      if (error) throw new Error(`update invoice: ${error.message}`);
    }

    if (input.items !== undefined) {
      // Reemplazar ítems: borrar los existentes e insertar los nuevos
      await this.client.from('invoice_items').delete().eq('invoice_id', id);
      if (input.items.length > 0) {
        const itemRows = input.items.map((item, i) =>
          buildItemInsertRow(`item-${id}-upd-${i + 1}`, id, item, i),
        );
        const { error: itemErr } = await this.client.from('invoice_items').insert(itemRows);
        if (itemErr) throw new Error(`update invoice_items: ${itemErr.message}`);
      }
    }

    return this.findInvoiceById(id, tenantId);
  }

  async cancelInvoice(
    id: string,
    reason?: string,
    tenantId?: string,
  ): Promise<EnrichedInvoice | null> {
    const existing = await this.findInvoiceById(id, tenantId);
    if (!existing) return null;
    let q = this.client
      .from('invoices')
      .update({
        status: 'canceled',
        cfdi_status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancel_reason: reason ?? null,
      })
      .eq('id', id);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { error } = await q;
    if (error) throw new Error(`cancel invoice: ${error.message}`);
    return this.findInvoiceById(id, tenantId);
  }

  async recordPayment(
    invoiceId: string,
    input: PaymentRecordInput,
    tenantId?: string,
  ): Promise<EnrichedInvoice> {
    const existing = await this.findInvoiceById(invoiceId, tenantId);
    if (!existing) throw new Error(`Invoice not found: ${invoiceId}`);

    const paymentCents = Math.round(input.amount * 100);
    const paymentId = `pay-${invoiceId}-${Date.now()}`;
    const paId      = `pa-${invoiceId}-${Date.now()}`;
    const tenant = tenantId || existing.tenantId || 'tenant-default';

    // INSERT payment
    const payRow: Record<string, unknown> = {
      id: paymentId,
      client_id: existing.clientId,
      client_name: existing.clientName,
      amount_cents: paymentCents,
      method: input.method,
      transaction_id: input.transactionId || null,
      payment_date: new Date().toISOString(),
      status: 'confirmed',
      tenant_id: tenant,
    };
    let { error: payErr } = await this.client.from('payments').insert(payRow);
    if (payErr && /tenant_id/i.test(payErr.message || '')) {
      const { tenant_id: _omit, ...without } = payRow;
      ({ error: payErr } = await this.client.from('payments').insert(without));
    }
    if (payErr) throw new Error(`insert payment: ${payErr.message}`);

    // INSERT payment_application
    const paRow: Record<string, unknown> = {
      id: paId,
      payment_id: paymentId,
      invoice_id: invoiceId,
      applied_cents: paymentCents,
      applied_at: new Date().toISOString(),
      tenant_id: tenant,
    };
    let { error: paErr } = await this.client.from('payment_applications').insert(paRow);
    if (paErr && /tenant_id/i.test(paErr.message || '')) {
      const { tenant_id: _omit, ...without } = paRow;
      ({ error: paErr } = await this.client.from('payment_applications').insert(without));
    }
    if (paErr) throw new Error(`insert payment_application: ${paErr.message}`);

    // UPDATE invoices: incrementar applied_cents + amount_paid
    const newAppliedCents = (existing.paidAmount * 100) + paymentCents;
    const newAmountPaid = roundMoney(newAppliedCents / 100);
    let upd = this.client
      .from('invoices')
      .update({ applied_cents: newAppliedCents, amount_paid: newAmountPaid })
      .eq('id', invoiceId);
    if (tenantId) upd = upd.eq('tenant_id', tenantId);
    const { error: updErr } = await upd;
    if (updErr) throw new Error(`update applied_cents: ${updErr.message}`);

    // Calcular nuevo status y actualizar en DB
    const newPending = roundMoney(Math.max(existing.amount - newAmountPaid, 0));
    const isPastDue  = new Date(existing.dueDateStr).getTime() < Date.now();
    let newStatus: Invoice['status'];
    if (newPending <= 0) {
      newStatus = 'paid';
    } else if (isPastDue) {
      newStatus = 'overdue';
    } else {
      newStatus = 'unpaid';
    }

    const statusPatch: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'paid' && !existing.cfdiUuid) {
      statusPatch.cfdi_status = 'generated';
      statusPatch.cfdi_uuid =
        '4F17A9B9-' +
        Math.floor(Math.random() * 9000 + 1000) +
        '-4EF2-BD44-FFBBAA123' +
        Math.floor(Math.random() * 90 + 10);
    }
    await this.client.from('invoices').update(statusPatch).eq('id', invoiceId);

    logger.info(`Payment recorded: ${paymentId} → ${invoiceId} (${newStatus})`);
    return (await this.findInvoiceById(invoiceId))!;
  }

  async applyWebhookPayment(input: WebhookPaymentInput): Promise<WebhookPaymentResult> {
    const amountCents = webhookPaymentAmountCents(input.amount);
    // Una sola transacción Postgres: bloquea el evento, después la factura,
    // crea o recupera el pago por identidad, garantiza UNA aplicación y
    // recalcula totales desde la suma real. No hay fallback a la ruta
    // multi-write: si la RPC no existe, el flujo falla cerrado y es retryable.
    const { data, error } = await this.client.rpc('billing_apply_webhook_payment', {
      p_tenant_id: input.tenantId,
      p_event_id: input.claim.eventId,
      p_claim_token: input.claim.claimToken,
      p_invoice_id: input.invoiceId,
      p_amount_cents: amountCents,
      p_method: input.method,
      p_provider: input.provider,
      p_transaction_id: input.transactionId,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) {
      if (/idempotency_conflict/i.test(error.message || '')) {
        throw new IdempotencyConflictError(BILLING_IDEMPOTENCY_SCOPE, input.idempotencyKey);
      }
      throw new ServiceUnavailableError(
        'No fue posible aplicar el cobro de webhook de forma atómica.',
        'WEBHOOK_LEDGER_UNAVAILABLE',
      );
    }

    if (Array.isArray(data) && data.length !== 1) {
      throw new ServiceUnavailableError(
        'Billing devolvió una cardinalidad inválida para el cobro.',
        'WEBHOOK_LEDGER_INVALID_RESPONSE',
      );
    }
    const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const outcome = raw?.outcome;
    const wasSettledBefore = raw?.was_settled_before === true;
    const isSettledAfter = raw?.is_settled_after === true;
    const settlementWinner = raw?.settlement_winner === true;
    const canonicalPaymentId = typeof raw?.canonical_payment_id === 'string'
      ? raw.canonical_payment_id
      : null;
    if (outcome === 'ownership_lost') {
      return {
        outcome, invoice: null, wasSettledBefore, isSettledAfter, settlementWinner,
        canonicalPaymentId,
      };
    }
    if (outcome !== 'created' && outcome !== 'existing') {
      throw new ServiceUnavailableError(
        'Billing devolvió una respuesta desconocida para el cobro.',
        'WEBHOOK_LEDGER_INVALID_RESPONSE',
      );
    }
    if (!canonicalPaymentId) {
      throw new ServiceUnavailableError(
        'Billing no devolviÃ³ la identidad canÃ³nica del cobro.',
        'WEBHOOK_LEDGER_INVALID_RESPONSE',
      );
    }
    return {
      outcome,
      invoice: await this.findInvoiceById(input.invoiceId, input.tenantId),
      wasSettledBefore,
      isSettledAfter,
      settlementWinner,
      canonicalPaymentId,
    };
  }

  async generateInvoiceId(): Promise<string> {
    const { data } = await this.client
      .from('invoices')
      .select('id')
      .like('id', 'fac-%');
    let max = 100;
    for (const row of (data || []) as { id: string }[]) {
      const m = row.id.match(/^fac-(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `fac-${max + 1}`;
  }
}
