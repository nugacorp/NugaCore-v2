import { describe, it, expect } from 'vitest';
import {
  InvoiceRow,
  InvoiceItemRow,
  PaymentApplicationRow,
  rowToItem,
  rowToInvoicePayment,
  rowsToEnrichedInvoice,
  rowsToAllocations,
  buildInvoiceInsertRow,
  buildItemInsertRow,
} from '../../backend/domains/billing/mappers';

const makeRow = (overrides: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 'fac-1',
  client_id: 'c-1',
  client_name: 'Test Cliente',
  amount: 449,
  amount_paid: 449,
  issue_date: '2026-05-01',
  due_date: '2026-05-10',
  status: 'paid',
  cfdi_status: 'generated',
  cfdi_uuid: null,
  total_cents: 44900,
  applied_cents: 44900,
  credit_applied_cents: 0,
  balance_cents: 0,
  subtotal_cents: 44900,
  discount_cents: 0,
  tax_cents: 0,
  subscription_id: null,
  billing_period_start: null,
  billing_period_end: null,
  canceled_at: null,
  cancel_reason: null,
  idempotency_key: null,
  created_by: null,
  cfdi_xml_url: null,
  ...overrides,
});

const makeItemRow = (overrides: Partial<InvoiceItemRow> = {}): InvoiceItemRow => ({
  id: 'item-1',
  invoice_id: 'fac-1',
  description: 'Internet 50M',
  price: 449,
  qty: 1,
  unit_price_cents: 44900,
  discount_cents: 0,
  tax_rate: 0.16,
  sort_order: 0,
  ...overrides,
});

const makeApp = (overrides: Partial<PaymentApplicationRow> = {}): PaymentApplicationRow => ({
  id: 'pa-1',
  payment_id: 'pay-1',
  invoice_id: 'fac-1',
  applied_cents: 44900,
  applied_at: '2026-05-05T10:30:00Z',
  applied_by: null,
  payment: {
    id: 'pay-1',
    client_id: 'c-1',
    client_name: 'Test Cliente',
    amount_cents: 44900,
    method: 'Stripe',
    transaction_id: 'ch_abc123',
    idempotency_key: null,
    payment_date: '2026-05-05T10:30:00Z',
    status: 'confirmed',
  },
  ...overrides,
});

describe('rowToItem', () => {
  it('mapea description, price y qty', () => {
    const item = rowToItem(makeItemRow());
    expect(item.description).toBe('Internet 50M');
    expect(item.price).toBe(449);
    expect(item.qty).toBe(1);
  });

  it('price como string NUMERIC se convierte a number', () => {
    const item = rowToItem(makeItemRow({ price: '449.00' as unknown as number }));
    expect(item.price).toBe(449);
  });
});

describe('rowToInvoicePayment', () => {
  it('convierte applied_cents → amount en pesos', () => {
    const p = rowToInvoicePayment(makeApp());
    expect(p.amount).toBe(449);
    expect(p.method).toBe('Stripe');
    expect(p.transactionId).toBe('ch_abc123');
  });

  it('formatea la fecha como YYYY-MM-DD HH:mm', () => {
    const p = rowToInvoicePayment(makeApp({ applied_at: '2026-05-05T10:30:00Z' }));
    expect(p.date).toBe('2026-05-05 10:30');
  });

  it('funciona sin payment adjunto', () => {
    const p = rowToInvoicePayment({ ...makeApp(), payment: undefined });
    expect(p.method).toBe('Transferencia');
    expect(p.transactionId).toBeUndefined();
  });
});

describe('rowsToEnrichedInvoice', () => {
  it('factura pagada tiene status=paid y paidAmount correcto', () => {
    const inv = rowsToEnrichedInvoice(makeRow(), [makeItemRow()], [makeApp()]);
    expect(inv.status).toBe('paid');
    expect(inv.paidAmount).toBe(449);
    expect(inv.pendingAmount).toBe(0);
    expect(inv.clientId).toBe('c-1');
    expect(inv.dateStr).toBe('2026-05-01');
    expect(inv.dueDateStr).toBe('2026-05-10');
  });

  it('factura vencida sin pagos tiene status=overdue', () => {
    const row = makeRow({
      applied_cents: 0,
      amount_paid: 0,
      due_date: '2026-01-01',  // pasado
      status: 'unpaid',
    });
    const inv = rowsToEnrichedInvoice(row, [], []);
    expect(inv.status).toBe('overdue');
    expect(inv.pendingAmount).toBe(449);
    expect(inv.paidAmount).toBe(0);
    expect(inv.payments).toHaveLength(0);
  });

  it('factura cancelada mantiene status=canceled', () => {
    const inv = rowsToEnrichedInvoice(makeRow({ status: 'canceled' }), [], []);
    expect(inv.status).toBe('canceled');
  });

  it('items se mapean correctamente', () => {
    const inv = rowsToEnrichedInvoice(makeRow(), [makeItemRow()], []);
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].description).toBe('Internet 50M');
  });

  it('amount como string NUMERIC se convierte a number', () => {
    const inv = rowsToEnrichedInvoice(makeRow({ amount: '449.00' as unknown as number }), [], []);
    expect(typeof inv.amount).toBe('number');
    expect(inv.amount).toBe(449);
  });
});

describe('rowsToAllocations', () => {
  it('genera AllocationEntry con remainingAfterPayment correcto', () => {
    const allocs = rowsToAllocations([makeApp()], 449);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].amount).toBe(449);
    expect(allocs[0].method).toBe('Stripe');
    expect(allocs[0].remainingAfterPayment).toBe(0);
    expect(allocs[0].transactionId).toBe('ch_abc123');
  });

  it('acumula correctamente dos pagos parciales', () => {
    const app1 = makeApp({ id: 'pa-1', applied_cents: 20000 });
    const app2 = makeApp({ id: 'pa-2', applied_cents: 24900 });
    const allocs = rowsToAllocations([app1, app2], 449);
    expect(allocs[0].remainingAfterPayment).toBe(249);
    expect(allocs[1].remainingAfterPayment).toBe(0);
  });
});

describe('buildInvoiceInsertRow', () => {
  it('convierte pesos a cents correctamente', () => {
    const row = buildInvoiceInsertRow('fac-1', 'c-1', 'Test', 449, '2026-06-10');
    expect(row.total_cents).toBe(44900);
    expect(row.subtotal_cents).toBe(44900);
    expect(row.applied_cents).toBe(0);
    expect(row.amount).toBe(449);
    expect(row.status).toBe('unpaid');
  });
});

describe('buildItemInsertRow', () => {
  it('construye el row de ítem correctamente', () => {
    const row = buildItemInsertRow('item-1', 'fac-1', { description: 'Internet', price: 299, qty: 1 }, 0);
    expect(row.unit_price_cents).toBe(29900);
    expect(row.price).toBe(299);
    expect(row.sort_order).toBe(0);
  });
});
