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
  AllocationEntry,
  EnrichedInvoice,
  InvoiceItem,
  InvoiceItemRow,
  InvoiceRow,
  PaymentApplicationRow,
  buildInvoiceInsertRow,
  buildItemInsertRow,
  rowToItem,
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

// ── Contrato ──────────────────────────────────────────────────────────

export interface BillingRepository {
  listInvoices(): Promise<EnrichedInvoice[]>;
  findInvoiceById(id: string): Promise<EnrichedInvoice | null>;
  getAccountState(invoiceId: string): Promise<AccountStateResult | null>;
  getAccountSummary(): Promise<AccountSummaryResult>;
  getRevenueReport(): Promise<RevenueReportResult>;
  createInvoice(input: InvoiceCreateInput): Promise<EnrichedInvoice>;
  updateInvoice(id: string, input: InvoiceUpdateInput): Promise<EnrichedInvoice | null>;
  cancelInvoice(id: string, reason?: string): Promise<EnrichedInvoice | null>;
  recordPayment(invoiceId: string, input: PaymentRecordInput): Promise<EnrichedInvoice>;
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
  paidAmount: invoicePaidAmount(inv),
  pendingAmount: invoicePendingAmount(inv),
});

// ────────────────────────────────────────────────────────────────────
// IMPLEMENTACIÓN 1 — Store en memoria (idéntico al comportamiento actual)
// ────────────────────────────────────────────────────────────────────
export class StoreBillingRepository implements BillingRepository {
  async listInvoices(): Promise<EnrichedInvoice[]> {
    store.INVOICES.forEach(syncStatus);
    return store.INVOICES.map(enrich);
  }

  async findInvoiceById(id: string): Promise<EnrichedInvoice | null> {
    const inv = store.INVOICES.find((i) => i.id === id);
    if (!inv) return null;
    syncStatus(inv);
    return enrich(inv);
  }

  async getAccountState(invoiceId: string): Promise<AccountStateResult | null> {
    const inv = store.INVOICES.find((i) => i.id === invoiceId);
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

  async getAccountSummary(): Promise<AccountSummaryResult> {
    store.INVOICES.forEach(syncStatus);
    return store.INVOICES.reduce(
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
        invoicesCount: store.INVOICES.length,
      },
    );
  }

  async getRevenueReport(): Promise<RevenueReportResult> {
    store.INVOICES.forEach(syncStatus);
    const byMethod = new Map<string, number>();
    for (const inv of store.INVOICES) {
      for (const p of inv.payments) {
        const m = p.method || 'Otro';
        byMethod.set(m, roundMoney((byMethod.get(m) || 0) + Number(p.amount || 0)));
      }
    }
    const topPending = store.INVOICES
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
    };
    store.INVOICES.unshift(inv);
    return enrich(inv);
  }

  async updateInvoice(id: string, input: InvoiceUpdateInput): Promise<EnrichedInvoice | null> {
    const inv = store.INVOICES.find((i) => i.id === id);
    if (!inv) return null;
    if (input.amount !== undefined) inv.amount = input.amount;
    if (input.dueDateStr !== undefined) inv.dueDateStr = input.dueDateStr;
    if (input.items !== undefined) inv.items = input.items;
    if (input.status !== undefined) inv.status = input.status;
    syncStatus(inv);
    return enrich(inv);
  }

  async cancelInvoice(id: string, _reason?: string): Promise<EnrichedInvoice | null> {
    const inv = store.INVOICES.find((i) => i.id === id);
    if (!inv) return null;
    inv.status = 'canceled';
    inv.cfdiStatus = 'canceled';
    return enrich(inv);
  }

  async recordPayment(invoiceId: string, input: PaymentRecordInput): Promise<EnrichedInvoice> {
    const inv = store.INVOICES.find((i) => i.id === invoiceId)!;
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
      .select('id, payment_id, invoice_id, applied_cents, applied_at, applied_by, payments(id, method, transaction_id, amount_cents, payment_date, status)')
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

  async listInvoices(): Promise<EnrichedInvoice[]> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`invoices list: ${error.message}`);
    const rows = (data || []) as InvoiceRow[];
    const ids = rows.map((r) => r.id);
    const [itemMap, appMap] = await Promise.all([
      this.loadItems(ids),
      this.loadPaymentApps(ids),
    ]);
    return this.buildEnriched(rows, itemMap, appMap);
  }

  async findInvoiceById(id: string): Promise<EnrichedInvoice | null> {
    const { data, error } = await this.client
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return null;
    const row = data as InvoiceRow;
    const [itemMap, appMap] = await Promise.all([
      this.loadItems([id]),
      this.loadPaymentApps([id]),
    ]);
    return rowsToEnrichedInvoice(row, itemMap.get(id) ?? [], appMap.get(id) ?? []);
  }

  async getAccountState(invoiceId: string): Promise<AccountStateResult | null> {
    const invoice = await this.findInvoiceById(invoiceId);
    if (!invoice) return null;
    const appMap = await this.loadPaymentApps([invoiceId]);
    const apps = appMap.get(invoiceId) ?? [];
    const allocations = rowsToAllocations(apps, invoice.amount);
    return { invoice, allocations };
  }

  async getAccountSummary(): Promise<AccountSummaryResult> {
    const invoices = await this.listInvoices();
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

  async getRevenueReport(): Promise<RevenueReportResult> {
    const invoices = await this.listInvoices();
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
    );

    const { error: invErr } = await this.client.from('invoices').insert(invoiceRow);
    if (invErr) throw new Error(`create invoice: ${invErr.message}`);

    if (input.items.length > 0) {
      const itemRows = input.items.map((item, i) =>
        buildItemInsertRow(`item-${id}-${i + 1}`, id, item, i),
      );
      const { error: itemErr } = await this.client.from('invoice_items').insert(itemRows);
      if (itemErr) throw new Error(`create invoice_items: ${itemErr.message}`);
    }

    const created = await this.findInvoiceById(id);
    return created!;
  }

  async updateInvoice(id: string, input: InvoiceUpdateInput): Promise<EnrichedInvoice | null> {
    const existing = await this.findInvoiceById(id);
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
      const { error } = await this.client.from('invoices').update(patch).eq('id', id);
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

    return this.findInvoiceById(id);
  }

  async cancelInvoice(id: string, reason?: string): Promise<EnrichedInvoice | null> {
    const existing = await this.findInvoiceById(id);
    if (!existing) return null;
    const { error } = await this.client
      .from('invoices')
      .update({
        status: 'canceled',
        cfdi_status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancel_reason: reason ?? null,
      })
      .eq('id', id);
    if (error) throw new Error(`cancel invoice: ${error.message}`);
    return this.findInvoiceById(id);
  }

  async recordPayment(invoiceId: string, input: PaymentRecordInput): Promise<EnrichedInvoice> {
    const existing = await this.findInvoiceById(invoiceId);
    if (!existing) throw new Error(`Invoice not found: ${invoiceId}`);

    const paymentCents = Math.round(input.amount * 100);
    const paymentId = `pay-${invoiceId}-${Date.now()}`;
    const paId      = `pa-${invoiceId}-${Date.now()}`;

    // INSERT payment
    const { error: payErr } = await this.client.from('payments').insert({
      id: paymentId,
      client_id: existing.clientId,
      client_name: existing.clientName,
      amount_cents: paymentCents,
      method: input.method,
      transaction_id: input.transactionId || null,
      payment_date: new Date().toISOString(),
      status: 'confirmed',
    });
    if (payErr) throw new Error(`insert payment: ${payErr.message}`);

    // INSERT payment_application
    const { error: paErr } = await this.client.from('payment_applications').insert({
      id: paId,
      payment_id: paymentId,
      invoice_id: invoiceId,
      applied_cents: paymentCents,
      applied_at: new Date().toISOString(),
    });
    if (paErr) throw new Error(`insert payment_application: ${paErr.message}`);

    // UPDATE invoices: incrementar applied_cents + amount_paid
    const newAppliedCents = (existing.paidAmount * 100) + paymentCents;
    const newAmountPaid = roundMoney(newAppliedCents / 100);
    const { error: updErr } = await this.client
      .from('invoices')
      .update({ applied_cents: newAppliedCents, amount_paid: newAmountPaid })
      .eq('id', invoiceId);
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
