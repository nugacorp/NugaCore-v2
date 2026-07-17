// ====================================================================
// Service del dominio Billing.
//
// Concentra reglas de negocio y validaciones, delega la persistencia al
// repository (store mock o Supabase, según USE_DB_BILLING).
// No conoce Express (sin req/res): lógica pura y testeable.
//
// Alcance Fase 4.2:
//   - Facturas: crear, listar, obtener, editar, registrar pago.
//   - Sin CFDI real, sin suspensión automática, sin pagos en línea.
// ====================================================================

import { Invoice } from '../../../src/types';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { BadRequestError } from '../../common/errors';
import { logger } from '../../common/logger';
import { InvoiceItem } from './mappers';
import {
  AccountStateResult,
  AccountSummaryResult,
  BillingRepository,
  EnrichedInvoice,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  PaymentRecordInput,
  RevenueReportResult,
  StoreBillingRepository,
  SupabaseBillingRepository,
} from './repository';
import { AccountBalance, CreatePaymentBody, PaymentRecord } from './types';

const roundMoney = (v: number): number => Math.round(v * 100) / 100;

/** Aplana los pagos de una factura enriquecida a la forma de recurso PaymentRecord. */
const invoiceToPaymentRecords = (inv: EnrichedInvoice): PaymentRecord[] =>
  inv.payments.map((p, i) => ({
    id: `${inv.id}-p${i + 1}`,
    invoiceId: inv.id,
    customerId: inv.clientId,
    customerName: inv.clientName,
    amount: roundMoney(Number(p.amount || 0)),
    paymentDate: p.date,
    paymentMethod: p.method || 'Transferencia',
    reference: p.transactionId ?? null,
  }));

const DEFAULT_DUE_DAYS = 10;

const todayPlus = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

const DEFAULT_ITEM = (amount: number): InvoiceItem => ({
  description: 'Servicio de Internet banda ancha para Suscriptor',
  price: amount,
  qty: 1,
});

// ── Tipos de entrada ──────────────────────────────────────────────────

export interface CreateInvoiceBody {
  clientId?: unknown;
  amount?: unknown;
  dueDateStr?: unknown;
  items?: unknown;
}

export interface UpdateInvoiceBody {
  amount?: unknown;
  dueDateStr?: unknown;
  items?: unknown;
  status?: unknown;
}

export interface PaymentBody {
  method?: unknown;
  amount?: unknown;
  transactionId?: unknown;
}

// ── Service ───────────────────────────────────────────────────────────

export class BillingService {
  constructor(private readonly repo: BillingRepository) {}

  // ── Validaciones ───────────────────────────────────────────────────

  validateCreateInvoice(body: CreateInvoiceBody): {
    clientId: string;
    amount: number;
    dueDateStr: string;
    items: InvoiceItem[];
  } {
    if (!body.clientId) {
      throw new BadRequestError('Missing required field: clientId', 'MISSING_FIELD');
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestError('amount must be a non-negative number', 'INVALID_AMOUNT');
    }
    const dueDateStr =
      typeof body.dueDateStr === 'string' && body.dueDateStr.trim().length >= 8
        ? body.dueDateStr.trim()
        : todayPlus(DEFAULT_DUE_DAYS);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items: InvoiceItem[] =
      rawItems.length > 0
        ? rawItems.map((it: unknown) => {
            const item = it as { description?: unknown; price?: unknown; qty?: unknown };
            return {
              description: String(item.description || '').trim() || 'Servicio',
              price: Number(item.price) || 0,
              qty: Math.max(1, Math.round(Number(item.qty) || 1)),
            };
          })
        : [DEFAULT_ITEM(amount)];

    return { clientId: String(body.clientId), amount, dueDateStr, items };
  }

  validateUpdateInvoice(body: UpdateInvoiceBody): InvoiceUpdateInput {
    const patch: InvoiceUpdateInput = {};
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount)) {
        throw new BadRequestError('amount must be a number', 'INVALID_AMOUNT');
      }
      patch.amount = amount;
    }
    if (body.dueDateStr !== undefined) {
      patch.dueDateStr = String(body.dueDateStr);
    }
    if (body.items !== undefined) {
      patch.items = Array.isArray(body.items)
        ? (body.items as { description?: unknown; price?: unknown; qty?: unknown }[]).map((it) => ({
            description: String(it.description || '').trim() || 'Servicio',
            price: Number(it.price) || 0,
            qty: Math.max(1, Math.round(Number(it.qty) || 1)),
          }))
        : [];
    }
    if (body.status !== undefined) {
      const VALID: Invoice['status'][] = ['paid', 'unpaid', 'overdue', 'canceled'];
      if (!VALID.includes(body.status as Invoice['status'])) {
        throw new BadRequestError('Invalid status', 'INVALID_ENUM');
      }
      patch.status = body.status as Invoice['status'];
    }
    return patch;
  }

  /**
   * Valida el cuerpo del pago. Devuelve el payload validado + el importe
   * efectivo (o null si se debe pagar el balance completo).
   */
  validatePayment(
    invoice: EnrichedInvoice,
    body: PaymentBody,
  ): PaymentRecordInput {
    if (invoice.pendingAmount <= 0) {
      throw new BadRequestError('Invoice is already fully paid', 'ALREADY_PAID');
    }
    const rawAmount = body.amount !== undefined ? Number(body.amount) : null;
    let amount: number;
    if (rawAmount === null || !Number.isFinite(rawAmount) || rawAmount <= 0) {
      // sin monto = pagar el balance completo
      amount = invoice.pendingAmount;
    } else {
      amount = Math.round(rawAmount * 100) / 100;
    }
    if (amount > invoice.pendingAmount) {
      throw new BadRequestError(
        'Payment amount exceeds invoice pending balance',
        'OVERPAYMENT',
      );
    }
    const method = typeof body.method === 'string' && body.method.trim()
      ? body.method.trim()
      : 'Transferencia';
    const transactionId =
      typeof body.transactionId === 'string' && body.transactionId.trim()
        ? body.transactionId.trim()
        : 'TXN_' + Math.random().toString(36).substring(3, 11).toUpperCase();

    return { amount, method, transactionId };
  }

  // ── Métodos delegados ─────────────────────────────────────────────

  listInvoices(tenantId?: string): Promise<EnrichedInvoice[]> {
    return this.repo.listInvoices(tenantId);
  }

  findInvoiceById(id: string, tenantId?: string): Promise<EnrichedInvoice | null> {
    return this.repo.findInvoiceById(id, tenantId);
  }

  getAccountState(invoiceId: string, tenantId?: string): Promise<AccountStateResult | null> {
    return this.repo.getAccountState(invoiceId, tenantId);
  }

  getAccountSummary(tenantId?: string): Promise<AccountSummaryResult> {
    return this.repo.getAccountSummary(tenantId);
  }

  getRevenueReport(tenantId?: string): Promise<RevenueReportResult> {
    return this.repo.getRevenueReport(tenantId);
  }

  createInvoice(input: InvoiceCreateInput): Promise<EnrichedInvoice> {
    return this.repo.createInvoice(input);
  }

  updateInvoice(
    id: string,
    input: InvoiceUpdateInput,
    tenantId?: string,
  ): Promise<EnrichedInvoice | null> {
    return this.repo.updateInvoice(id, input, tenantId);
  }

  recordPayment(
    invoiceId: string,
    input: PaymentRecordInput,
    tenantId?: string,
  ): Promise<EnrichedInvoice> {
    return this.repo.recordPayment(invoiceId, input, tenantId);
  }

  cancelInvoice(
    id: string,
    reason?: string,
    tenantId?: string,
  ): Promise<EnrichedInvoice | null> {
    return this.repo.cancelInvoice(id, reason, tenantId);
  }

  generateInvoiceId(): Promise<string> {
    return this.repo.generateInvoiceId();
  }

  // ── Foundation: balance, pagos como recurso y ciclo ─────────────────

  /** Estado de cuenta consolidado de un cliente (saldo actual, vencido, último pago). */
  async getCustomerBalance(
    customerId: string,
    fallbackName?: string,
    tenantId?: string,
  ): Promise<AccountBalance> {
    const invoices = (await this.repo.listInvoices(tenantId)).filter((i) => i.clientId === customerId);
    const active = invoices.filter((i) => i.status !== 'canceled');

    const currentBalance = roundMoney(active.reduce((s, i) => s + i.pendingAmount, 0));
    const overdue = active.filter((i) => i.status === 'overdue');
    const overdueBalance = roundMoney(overdue.reduce((s, i) => s + i.pendingAmount, 0));

    const payments = invoices
      .flatMap(invoiceToPaymentRecords)
      .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
    const lastPayment = payments[0] ?? null;

    return {
      customerId,
      customerName: invoices[0]?.clientName ?? fallbackName ?? customerId,
      currentBalance,
      overdueBalance,
      totalBalance: currentBalance,
      pendingInvoices: active.filter((i) => i.pendingAmount > 0).length,
      overdueInvoices: overdue.length,
      lastPaymentAmount: lastPayment ? lastPayment.amount : null,
      lastPaymentDate: lastPayment ? lastPayment.paymentDate : null,
    };
  }

  /** Lista de pagos como recurso (proyección de las aplicaciones de pago). */
  async listPayments(filter?: {
    customerId?: string;
    invoiceId?: string;
    tenantId?: string;
  }): Promise<PaymentRecord[]> {
    const invoices = await this.repo.listInvoices(filter?.tenantId);
    let records = invoices.flatMap(invoiceToPaymentRecords);
    if (filter?.customerId) records = records.filter((p) => p.customerId === filter.customerId);
    if (filter?.invoiceId) records = records.filter((p) => p.invoiceId === filter.invoiceId);
    return records.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }

  /**
   * Registra un pago como recurso (POST /api/billing/payments).
   * Valida, delega en recordPayment y devuelve el PaymentRecord + la factura.
   */
  async createPayment(
    body: CreatePaymentBody,
    tenantId?: string,
  ): Promise<{ payment: PaymentRecord; invoice: EnrichedInvoice }> {
    if (!body.invoiceId || typeof body.invoiceId !== 'string') {
      throw new BadRequestError('Missing required field: invoiceId', 'MISSING_FIELD');
    }
    const invoice = await this.repo.findInvoiceById(body.invoiceId, tenantId);
    if (!invoice) {
      throw new BadRequestError('Invoice not found', 'INVOICE_NOT_FOUND');
    }
    if (invoice.status === 'canceled') {
      throw new BadRequestError('Cannot pay a canceled invoice', 'INVOICE_CANCELED');
    }

    // Normaliza alias de la spec (paymentMethod/reference) al contrato interno.
    const paymentInput = this.validatePayment(invoice, {
      amount: body.amount,
      method: (typeof body.paymentMethod === 'string' && body.paymentMethod) || body.method,
      transactionId: (typeof body.reference === 'string' && body.reference) || body.transactionId,
    });

    const updated = await this.repo.recordPayment(invoice.id, paymentInput, tenantId);
    const records = invoiceToPaymentRecords(updated);
    const payment = records[records.length - 1];
    return { payment, invoice: updated };
  }
}

// ── Factoría singleton ────────────────────────────────────────────────

let singleton: BillingService | null = null;

const buildService = (): BillingService => {
  if (isDomainOnDb('billing')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'USE_DB_BILLING=true pero Supabase no está configurado. ' +
        'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    logger.info('Billing domain: persistencia = Supabase (USE_DB_BILLING=true)');
    return new BillingService(new SupabaseBillingRepository(supabaseAdmin));
  }
  logger.info('Billing domain: persistencia = store en memoria (USE_DB_BILLING=false)');
  return new BillingService(new StoreBillingRepository());
};

export const getBillingService = (): BillingService => {
  if (!singleton) singleton = buildService();
  return singleton;
};
