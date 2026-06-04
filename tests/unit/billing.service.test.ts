import { describe, it, expect, beforeEach } from 'vitest';
import { BillingService } from '../../backend/domains/billing/service';
import {
  AccountStateResult,
  AccountSummaryResult,
  BillingRepository,
  EnrichedInvoice,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  PaymentRecordInput,
  RevenueReportResult,
} from '../../backend/domains/billing/repository';

// ── Repositorio falso (in-memory, aislado del store) ─────────────────

class FakeRepo implements BillingRepository {
  invoices: EnrichedInvoice[] = [];
  private seq = 100;

  private byId(id: string): EnrichedInvoice | undefined {
    return this.invoices.find((i) => i.id === id);
  }

  async listInvoices() { return [...this.invoices]; }

  async findInvoiceById(id: string) { return this.byId(id) ?? null; }

  async getAccountState(id: string): Promise<AccountStateResult | null> {
    const inv = this.byId(id);
    if (!inv) return null;
    return { invoice: inv, allocations: [] };
  }

  async getAccountSummary(): Promise<AccountSummaryResult> {
    return {
      totalInvoiced: 0, totalCollected: 0, totalPending: 0,
      overdueCount: 0, paidCount: 0, unpaidCount: 0, invoicesCount: this.invoices.length,
    };
  }

  async getRevenueReport(): Promise<RevenueReportResult> {
    return { generatedAt: '', byMethod: [], topPendingInvoices: [] };
  }

  async createInvoice(input: InvoiceCreateInput): Promise<EnrichedInvoice> {
    const id = await this.generateInvoiceId();
    const inv: EnrichedInvoice = {
      id,
      clientId: input.clientId,
      clientName: input.clientName,
      amount: input.amount,
      dateStr: '2026-06-01',
      dueDateStr: input.dueDateStr,
      status: 'unpaid',
      cfdiStatus: 'pending',
      items: input.items,
      payments: [],
      paidAmount: 0,
      pendingAmount: input.amount,
    };
    this.invoices.push(inv);
    return inv;
  }

  async updateInvoice(id: string, input: InvoiceUpdateInput): Promise<EnrichedInvoice | null> {
    const inv = this.byId(id);
    if (!inv) return null;
    if (input.amount !== undefined) {
      inv.amount = input.amount;
      inv.pendingAmount = input.amount - inv.paidAmount;
    }
    if (input.dueDateStr !== undefined) inv.dueDateStr = input.dueDateStr;
    if (input.items !== undefined) inv.items = input.items;
    if (input.status !== undefined) inv.status = input.status;
    return inv;
  }

  async recordPayment(invoiceId: string, input: PaymentRecordInput): Promise<EnrichedInvoice> {
    const inv = this.byId(invoiceId)!;
    inv.payments.push({ date: '2026-06-01 10:00', amount: input.amount, method: input.method });
    inv.paidAmount = Math.round((inv.paidAmount + input.amount) * 100) / 100;
    inv.pendingAmount = Math.max(inv.amount - inv.paidAmount, 0);
    if (inv.pendingAmount <= 0) inv.status = 'paid';
    return inv;
  }

  async generateInvoiceId(): Promise<string> {
    this.seq += 1;
    return `fac-${this.seq}`;
  }
}

// ── Fixture ───────────────────────────────────────────────────────────

const makeInvoice = (overrides: Partial<EnrichedInvoice> = {}): EnrichedInvoice => ({
  id: 'fac-1',
  clientId: 'c-1',
  clientName: 'Test',
  amount: 449,
  dateStr: '2026-05-01',
  dueDateStr: '2026-05-10',
  status: 'unpaid',
  cfdiStatus: 'pending',
  items: [{ description: 'Internet 50M', price: 449, qty: 1 }],
  payments: [],
  paidAmount: 0,
  pendingAmount: 449,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('BillingService.validateCreateInvoice', () => {
  let service: BillingService;
  beforeEach(() => { service = new BillingService(new FakeRepo()); });

  it('rechaza body sin clientId', () => {
    expect(() => service.validateCreateInvoice({ amount: 449 })).toThrow('clientId');
  });

  it('rechaza amount negativo', () => {
    expect(() => service.validateCreateInvoice({ clientId: 'c-1', amount: -1 })).toThrow('non-negative');
  });

  it('rechaza amount no numérico', () => {
    expect(() => service.validateCreateInvoice({ clientId: 'c-1', amount: 'abc' })).toThrow();
  });

  it('genera dueDateStr por defecto (+10 días) si no se pasa', () => {
    const v = service.validateCreateInvoice({ clientId: 'c-1', amount: 0 });
    expect(v.dueDateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('crea ítem por defecto si no se pasan items', () => {
    const v = service.validateCreateInvoice({ clientId: 'c-1', amount: 299 });
    expect(v.items).toHaveLength(1);
    expect(v.items[0].price).toBe(299);
  });

  it('usa los items del body si se pasan', () => {
    const v = service.validateCreateInvoice({
      clientId: 'c-1',
      amount: 100,
      items: [{ description: 'Custom', price: 100, qty: 1 }],
    });
    expect(v.items[0].description).toBe('Custom');
  });
});

describe('BillingService.validateUpdateInvoice', () => {
  let service: BillingService;
  beforeEach(() => { service = new BillingService(new FakeRepo()); });

  it('permite patch vacío', () => {
    const patch = service.validateUpdateInvoice({});
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it('rechaza amount no numérico', () => {
    expect(() => service.validateUpdateInvoice({ amount: 'malo' })).toThrow();
  });

  it('rechaza status inválido', () => {
    expect(() => service.validateUpdateInvoice({ status: 'pagado' })).toThrow('status');
  });

  it('acepta status=canceled', () => {
    const patch = service.validateUpdateInvoice({ status: 'canceled' });
    expect(patch.status).toBe('canceled');
  });
});

describe('BillingService.validatePayment', () => {
  let service: BillingService;
  beforeEach(() => { service = new BillingService(new FakeRepo()); });

  const paid = makeInvoice({ status: 'paid', paidAmount: 449, pendingAmount: 0 });
  const unpaid = makeInvoice();

  it('rechaza pago si ya está pagada', () => {
    expect(() => service.validatePayment(paid, { amount: 100 })).toThrow('fully paid');
  });

  it('rechaza monto mayor al pendiente', () => {
    expect(() => service.validatePayment(unpaid, { amount: 500 })).toThrow('exceeds');
  });

  it('sin monto → paga el balance completo', () => {
    const r = service.validatePayment(unpaid, {});
    expect(r.amount).toBe(449);
  });

  it('acepta pago parcial válido', () => {
    const r = service.validatePayment(unpaid, { amount: 200 });
    expect(r.amount).toBe(200);
  });

  it('asigna método por defecto si falta', () => {
    const r = service.validatePayment(unpaid, {});
    expect(r.method).toBe('Transferencia');
  });

  it('usa el método del body', () => {
    const r = service.validatePayment(unpaid, { method: 'SPEI' });
    expect(r.method).toBe('SPEI');
  });

  it('genera transactionId si no se pasa', () => {
    const r = service.validatePayment(unpaid, {});
    expect(r.transactionId).toMatch(/^TXN_/);
  });
});

describe('BillingService — delegaciones', () => {
  let service: BillingService;
  let repo: FakeRepo;

  beforeEach(() => {
    repo = new FakeRepo();
    repo.invoices = [makeInvoice()];
    service = new BillingService(repo);
  });

  it('listInvoices devuelve todas las facturas del repo', async () => {
    const list = await service.listInvoices();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('fac-1');
  });

  it('findInvoiceById devuelve null para id inexistente', async () => {
    expect(await service.findInvoiceById('fac-nope')).toBeNull();
  });

  it('createInvoice delega al repo y retorna la factura', async () => {
    const inv = await service.createInvoice({
      clientId: 'c-2',
      clientName: 'Nuevo',
      amount: 299,
      dueDateStr: '2026-07-10',
      items: [{ description: 'Internet 20M', price: 299, qty: 1 }],
    });
    expect(inv.clientId).toBe('c-2');
    expect(inv.amount).toBe(299);
    expect(repo.invoices).toHaveLength(2);
  });

  it('recordPayment actualiza paidAmount y status', async () => {
    const updated = await service.recordPayment('fac-1', {
      amount: 449,
      method: 'SPEI',
      transactionId: 'SPEI001',
    });
    expect(updated.paidAmount).toBe(449);
    expect(updated.pendingAmount).toBe(0);
    expect(updated.status).toBe('paid');
  });

  it('updateInvoice modifica el monto', async () => {
    const updated = await service.updateInvoice('fac-1', { amount: 600 });
    expect(updated?.amount).toBe(600);
  });

  it('getAccountState devuelve el estado de cuenta', async () => {
    const state = await service.getAccountState('fac-1');
    expect(state).not.toBeNull();
    expect(state!.invoice.id).toBe('fac-1');
  });
});
