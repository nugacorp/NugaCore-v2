// ====================================================================
// Mappers del dominio Billing — traducen entre filas de Postgres
// (snake_case, tablas public.invoices / invoice_items / payments /
// payment_applications) y los tipos del frontend (src/types.ts).
//
// Regla del DATA_CONTRACT:
//   - Aquí ocurre la ÚNICA traducción de nombres/formatos.
//   - Montos en centavos (DB) ↔ pesos (API v1).
//   - El frontend nunca debe notar el cambio de backend.
// ====================================================================

import { Invoice } from '../../../src/types';

// ── Tipos de filas de DB ──────────────────────────────────────────────

export interface InvoiceRow {
  id: string;
  client_id: string;
  client_name: string;
  amount: number | string;             // NUMERIC → puede venir como string
  amount_paid: number | string;
  issue_date: string;                  // DATE → 'YYYY-MM-DD'
  due_date: string;
  status: Invoice['status'];
  cfdi_status: Invoice['cfdiStatus'];
  cfdi_uuid: string | null;
  total_cents: number;
  applied_cents: number;
  credit_applied_cents: number;
  balance_cents: number;               // GENERATED: total_cents - applied_cents - credit_applied_cents
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  subscription_id: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  cfdi_xml_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  description: string;
  price: number | string;              // NUMERIC legacy
  qty: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_rate: number | string;
  sort_order: number;
}

export interface PaymentRow {
  id: string;
  client_id: string;
  client_name: string;
  amount_cents: number;
  method: string;
  transaction_id: string | null;
  idempotency_key: string | null;
  payment_date: string;                // TIMESTAMPTZ
  status: string;
}

export interface PaymentApplicationRow {
  id: string;
  payment_id: string;
  invoice_id: string;
  applied_cents: number;
  applied_at: string;
  applied_by: string | null;
  payment?: PaymentRow;                // join opcional
}

// ── Tipos de API v1 ───────────────────────────────────────────────────

export type InvoiceItem    = Invoice['items'][number];
export type InvoicePayment = Invoice['payments'][number];

/** Invoice v1 enriquecido con paidAmount / pendingAmount (lo que retornan las rutas). */
export interface EnrichedInvoice extends Invoice {
  paidAmount: number;
  pendingAmount: number;
}

/** Mapa compatible con store.PaymentAllocation para account-state. */
export interface AllocationEntry {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  paymentDate: string;
  transactionId?: string;
  remainingAfterPayment: number;
}

// ── DB → App ──────────────────────────────────────────────────────────

const roundMoney = (v: number) => Math.round(v * 100) / 100;

export const rowToItem = (row: InvoiceItemRow): InvoiceItem => ({
  description: row.description,
  price: Number(row.price),
  qty: row.qty,
});

/** Convierte una payment_application + su payment adjunto en la forma v1. */
export const rowToInvoicePayment = (pa: PaymentApplicationRow): InvoicePayment => {
  const rawDate = pa.applied_at ?? pa.payment?.payment_date ?? '';
  // 'YYYY-MM-DD HH:mm' — mismo formato que el mock
  const dateStr = rawDate.length >= 16
    ? rawDate.substring(0, 16).replace('T', ' ')
    : rawDate;
  return {
    date: dateStr,
    amount: roundMoney(pa.applied_cents / 100),
    method: pa.payment?.method ?? 'Transferencia',
    ...(pa.payment?.transaction_id ? { transactionId: pa.payment.transaction_id } : {}),
  };
};

/**
 * Reconstruye el Invoice v1 completo desde las filas de DB más los joins de
 * ítems y aplicaciones de pago. Computa el status en tiempo real (igual que
 * syncInvoiceStatus en el mock) a partir de balance_cents y due_date.
 */
export const rowsToEnrichedInvoice = (
  row: InvoiceRow,
  items: InvoiceItemRow[],
  paymentApps: PaymentApplicationRow[],
): EnrichedInvoice => {
  const amount        = Number(row.amount);
  const paidAmount    = roundMoney(row.applied_cents / 100);
  const pendingAmount = roundMoney(Math.max(amount - paidAmount, 0));

  // Status en tiempo real (replica syncInvoiceStatus del mock)
  let status: Invoice['status'];
  if (row.status === 'canceled') {
    status = 'canceled';
  } else if (pendingAmount <= 0) {
    status = 'paid';
  } else if (new Date(row.due_date).getTime() < Date.now()) {
    status = 'overdue';
  } else {
    status = 'unpaid';
  }

  // cfdiStatus en tiempo real: si pagado → 'generated' (con uuid simulado si no tiene)
  let cfdiStatus: Invoice['cfdiStatus'] = row.cfdi_status;
  if (status === 'paid' && cfdiStatus === 'pending') {
    cfdiStatus = 'generated';
  } else if (status !== 'paid' && cfdiStatus === 'generated' && pendingAmount > 0) {
    cfdiStatus = 'pending';
  }

  // Pagos ordenados por fecha de aplicación
  const sortedApps = [...paymentApps].sort(
    (a, b) => new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime(),
  );

  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    amount,
    dateStr: row.issue_date,
    dueDateStr: row.due_date,
    status,
    cfdiStatus,
    ...(row.cfdi_uuid ? { cfdiUuid: row.cfdi_uuid } : {}),
    items: items
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(rowToItem),
    payments: sortedApps.map(rowToInvoicePayment),
    paidAmount,
    pendingAmount,
  };
};

/**
 * Convierte payment_applications en AllocationEntry[] compatible con
 * store.PaymentAllocation (para el endpoint account-state).
 */
export const rowsToAllocations = (
  paymentApps: PaymentApplicationRow[],
  invoiceAmountPesos: number,
): AllocationEntry[] => {
  const sorted = [...paymentApps].sort(
    (a, b) => new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime(),
  );
  let cumulativePaid = 0;
  return sorted.map((pa) => {
    const amount = roundMoney(pa.applied_cents / 100);
    cumulativePaid += amount;
    const remaining = roundMoney(Math.max(invoiceAmountPesos - cumulativePaid, 0));
    return {
      id: pa.id,
      invoiceId: pa.invoice_id,
      amount,
      method: pa.payment?.method ?? 'Transferencia',
      paymentDate: pa.applied_at,
      ...(pa.payment?.transaction_id ? { transactionId: pa.payment.transaction_id } : {}),
      remainingAfterPayment: remaining,
    };
  });
};

// ── App → DB ──────────────────────────────────────────────────────────

export interface InvoiceInsertRow {
  id: string;
  client_id: string;
  client_name: string;
  amount: number;
  amount_paid: number;
  issue_date: string;
  due_date: string;
  status: Invoice['status'];
  cfdi_status: Invoice['cfdiStatus'];
  subtotal_cents: number;
  total_cents: number;
  applied_cents: number;
  credit_applied_cents: number;
}

export const buildInvoiceInsertRow = (
  id: string,
  clientId: string,
  clientName: string,
  amountPesos: number,
  dueDateStr: string,
): InvoiceInsertRow => {
  const cents = Math.round(amountPesos * 100);
  return {
    id,
    client_id: clientId,
    client_name: clientName,
    amount: amountPesos,
    amount_paid: 0,
    issue_date: new Date().toISOString().substring(0, 10),
    due_date: dueDateStr,
    status: 'unpaid',
    cfdi_status: 'pending',
    subtotal_cents: cents,
    total_cents: cents,
    applied_cents: 0,
    credit_applied_cents: 0,
  };
};

export interface ItemInsertRow {
  id: string;
  invoice_id: string;
  description: string;
  price: number;
  qty: number;
  unit_price_cents: number;
  sort_order: number;
}

export const buildItemInsertRow = (
  id: string,
  invoiceId: string,
  item: InvoiceItem,
  sortOrder: number,
): ItemInsertRow => ({
  id,
  invoice_id: invoiceId,
  description: item.description,
  price: item.price,
  qty: item.qty,
  unit_price_cents: Math.round(item.price * 100),
  sort_order: sortOrder,
});
