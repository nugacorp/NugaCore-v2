// ====================================================================
// Helpers PUROS de presentación para Billing UI (Fase 4.3).
//
// Sin React, sin DOM: lógica testeable que deriva estado visual a partir
// de las facturas que devuelve el backend (EnrichedInvoice). Se extrae aquí
// para poder probarla con `.test.ts` en el entorno `node` existente, sin
// añadir @testing-library/react ni jsdom.
// ====================================================================

import type { Invoice, BillingAccountSummary } from '../types';

const roundMoney = (v: number): number => Math.round(v * 100) / 100;

/** Formatea pesos mexicanos. */
export const formatMXN = (num: number): string =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    Number.isFinite(num) ? num : 0,
  );

/** Monto pagado: usa el campo enriquecido del backend o lo deriva de payments. */
export function paidAmountOf(inv: Invoice): number {
  if (typeof inv.paidAmount === 'number') return roundMoney(inv.paidAmount);
  return roundMoney((inv.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));
}

/** Saldo pendiente: usa el campo enriquecido o lo deriva (amount - pagado, >= 0). */
export function pendingAmountOf(inv: Invoice): number {
  if (typeof inv.pendingAmount === 'number') return roundMoney(inv.pendingAmount);
  return roundMoney(Math.max(inv.amount - paidAmountOf(inv), 0));
}

/**
 * ¿La factura está parcialmente pagada? (tiene pagos pero aún queda saldo).
 * No es un `status` del backend: es una distinción VISUAL sobre `unpaid`/`overdue`.
 */
export function isPartiallyPaid(inv: Invoice): boolean {
  if (inv.status === 'paid' || inv.status === 'canceled') return false;
  return paidAmountOf(inv) > 0 && pendingAmountOf(inv) > 0;
}

export type BillingBadgeTone = 'paid' | 'unpaid' | 'overdue' | 'canceled' | 'partial';

export interface BillingBadge {
  tone: BillingBadgeTone;
  label: string;
}

/** Deriva el badge visual (incluye el caso "partial", que no es status backend). */
export function statusBadge(inv: Invoice): BillingBadge {
  if (inv.status === 'paid') return { tone: 'paid', label: 'Pagada' };
  if (inv.status === 'canceled') return { tone: 'canceled', label: 'Cancelada' };
  if (isPartiallyPaid(inv)) return { tone: 'partial', label: 'Pago Parcial' };
  if (inv.status === 'overdue') return { tone: 'overdue', label: 'Vencida / Corte' };
  return { tone: 'unpaid', label: 'Pendiente' };
}

/** ¿Se puede registrar un pago? (queda saldo y no está cancelada). */
export function isPayable(inv: Invoice): boolean {
  return inv.status !== 'canceled' && pendingAmountOf(inv) > 0;
}

/**
 * Resumen de cobranza derivado en cliente. Se usa SOLO como fallback cuando
 * `account-summary` aún no respondió; el valor canónico viene del backend.
 */
export function deriveSummary(invoices: Invoice[]): BillingAccountSummary {
  return invoices.reduce(
    (acc, inv) => {
      acc.totalInvoiced = roundMoney(acc.totalInvoiced + inv.amount);
      acc.totalCollected = roundMoney(acc.totalCollected + paidAmountOf(inv));
      acc.totalPending = roundMoney(acc.totalPending + pendingAmountOf(inv));
      if (inv.status === 'overdue') acc.overdueCount += 1;
      if (inv.status === 'paid') acc.paidCount += 1;
      if (inv.status === 'unpaid') acc.unpaidCount += 1;
      return acc;
    },
    {
      totalInvoiced: 0,
      totalCollected: 0,
      totalPending: 0,
      overdueCount: 0,
      paidCount: 0,
      unpaidCount: 0,
      invoicesCount: invoices.length,
    } as BillingAccountSummary,
  );
}

/**
 * Valida un monto de pago contra el saldo pendiente. Devuelve el monto efectivo
 * (clamp) y un posible error de UX. `raw` vacío/0 = pagar saldo completo.
 */
export function resolvePaymentAmount(
  inv: Invoice,
  raw: string | number | null | undefined,
): { amount: number; error: string | null } {
  const pending = pendingAmountOf(inv);
  if (pending <= 0) return { amount: 0, error: 'La factura ya está liquidada.' };

  const n = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    // Sin monto válido → pago completo del saldo.
    return { amount: pending, error: null };
  }
  const amount = roundMoney(n);
  if (amount > pending) {
    return { amount: pending, error: `El monto excede el saldo pendiente (${formatMXN(pending)}).` };
  }
  return { amount, error: null };
}
