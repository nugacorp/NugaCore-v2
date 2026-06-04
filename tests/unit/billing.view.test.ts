import { describe, it, expect } from 'vitest';
import {
  formatMXN,
  paidAmountOf,
  pendingAmountOf,
  isPartiallyPaid,
  statusBadge,
  isPayable,
  deriveSummary,
  resolvePaymentAmount,
} from '../../src/lib/billingView';
import { canManageBilling } from '../../src/lib/billingRbac';
import type { Invoice } from '../../src/types';
import type { UserRole } from '../../src/lib/supabase';

// ====================================================================
// Tests de la lógica de presentación de Billing (Fase 4.3).
//
// Cubren el "intent" de Task 8 sin entorno DOM: derivación de estado de
// factura (incluye partial / canceled), cómputo de resumen, validación de
// monto de pago (parcial / completo / sobrepago) y visibilidad por rol.
// ====================================================================

const baseInvoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'fac-1',
  clientId: 'cli-1',
  clientName: 'Cliente Demo',
  amount: 1000,
  dateStr: '2026-06-01',
  dueDateStr: '2026-06-15',
  status: 'unpaid',
  cfdiStatus: 'pending',
  items: [{ description: 'Internet', price: 1000, qty: 1 }],
  payments: [],
  ...over,
});

describe('billingView — montos', () => {
  it('paidAmountOf prefiere el campo enriquecido del backend', () => {
    const inv = baseInvoice({ paidAmount: 400, pendingAmount: 600, payments: [] });
    expect(paidAmountOf(inv)).toBe(400);
    expect(pendingAmountOf(inv)).toBe(600);
  });

  it('paidAmountOf deriva de payments cuando no hay campo enriquecido', () => {
    const inv = baseInvoice({
      payments: [
        { date: '2026-06-02', amount: 300, method: 'SPEI' },
        { date: '2026-06-03', amount: 200, method: 'OXXO' },
      ],
    });
    expect(paidAmountOf(inv)).toBe(500);
    expect(pendingAmountOf(inv)).toBe(500);
  });

  it('pendingAmount nunca es negativo', () => {
    const inv = baseInvoice({ amount: 100, paidAmount: 150, pendingAmount: 0 });
    expect(pendingAmountOf(inv)).toBe(0);
  });

  it('formatMXN devuelve moneda mexicana y tolera NaN', () => {
    expect(formatMXN(1000)).toContain('1,000');
    expect(formatMXN(NaN)).toContain('0');
  });
});

describe('billingView — badges de estado', () => {
  it('paid → badge Pagada', () => {
    expect(statusBadge(baseInvoice({ status: 'paid', paidAmount: 1000, pendingAmount: 0 })).tone).toBe('paid');
  });

  it('canceled → badge Cancelada (no partial aunque tenga pagos)', () => {
    const inv = baseInvoice({ status: 'canceled', paidAmount: 500, pendingAmount: 500 });
    expect(statusBadge(inv).tone).toBe('canceled');
    expect(isPartiallyPaid(inv)).toBe(false);
  });

  it('pago parcial sobre unpaid → badge partial', () => {
    const inv = baseInvoice({ status: 'unpaid', paidAmount: 400, pendingAmount: 600 });
    expect(isPartiallyPaid(inv)).toBe(true);
    expect(statusBadge(inv).tone).toBe('partial');
  });

  it('pago parcial sobre overdue → badge partial (prioriza visual de saldo)', () => {
    const inv = baseInvoice({ status: 'overdue', paidAmount: 100, pendingAmount: 900 });
    expect(statusBadge(inv).tone).toBe('partial');
  });

  it('overdue sin pagos → badge overdue', () => {
    expect(statusBadge(baseInvoice({ status: 'overdue', paidAmount: 0, pendingAmount: 1000 })).tone).toBe('overdue');
  });

  it('unpaid sin pagos → badge unpaid', () => {
    expect(statusBadge(baseInvoice({ paidAmount: 0, pendingAmount: 1000 })).tone).toBe('unpaid');
  });
});

describe('billingView — isPayable', () => {
  it('factura con saldo es pagable', () => {
    expect(isPayable(baseInvoice({ pendingAmount: 600 }))).toBe(true);
  });
  it('factura liquidada no es pagable', () => {
    expect(isPayable(baseInvoice({ status: 'paid', pendingAmount: 0 }))).toBe(false);
  });
  it('factura cancelada no es pagable', () => {
    expect(isPayable(baseInvoice({ status: 'canceled', pendingAmount: 500 }))).toBe(false);
  });
});

describe('billingView — deriveSummary (fallback de account-summary)', () => {
  it('agrega totales y conteos correctamente', () => {
    const invoices: Invoice[] = [
      baseInvoice({ id: 'a', amount: 1000, status: 'paid', paidAmount: 1000, pendingAmount: 0 }),
      baseInvoice({ id: 'b', amount: 500, status: 'unpaid', paidAmount: 0, pendingAmount: 500 }),
      baseInvoice({ id: 'c', amount: 800, status: 'overdue', paidAmount: 300, pendingAmount: 500 }),
    ];
    const s = deriveSummary(invoices);
    expect(s.totalInvoiced).toBe(2300);
    expect(s.totalCollected).toBe(1300);
    expect(s.totalPending).toBe(1000);
    expect(s.paidCount).toBe(1);
    expect(s.unpaidCount).toBe(1);
    expect(s.overdueCount).toBe(1);
    expect(s.invoicesCount).toBe(3);
  });
});

describe('billingView — resolvePaymentAmount (pago parcial / completo / sobrepago)', () => {
  it('monto vacío = pagar el saldo completo, sin error', () => {
    const inv = baseInvoice({ pendingAmount: 600 });
    expect(resolvePaymentAmount(inv, '')).toEqual({ amount: 600, error: null });
  });

  it('monto parcial válido se respeta', () => {
    const inv = baseInvoice({ pendingAmount: 600 });
    expect(resolvePaymentAmount(inv, '200')).toEqual({ amount: 200, error: null });
  });

  it('sobrepago se limita al saldo y reporta error', () => {
    const inv = baseInvoice({ pendingAmount: 600 });
    const r = resolvePaymentAmount(inv, '900');
    expect(r.amount).toBe(600);
    expect(r.error).toBeTruthy();
  });

  it('factura ya liquidada → error', () => {
    const inv = baseInvoice({ status: 'paid', pendingAmount: 0 });
    expect(resolvePaymentAmount(inv, '100').error).toBeTruthy();
  });
});

describe('billingRbac — canManageBilling (botones ocultos por rol)', () => {
  const writers: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza'];
  const readers: UserRole[] = ['Técnico', 'Soporte', 'Solo lectura'];

  it('roles de escritura pueden gestionar', () => {
    for (const r of writers) expect(canManageBilling(r)).toBe(true);
  });

  it('roles de lectura NO pueden gestionar (botones ocultos)', () => {
    for (const r of readers) expect(canManageBilling(r)).toBe(false);
  });

  it('rol nulo/indefinido → sin permisos', () => {
    expect(canManageBilling(null)).toBe(false);
    expect(canManageBilling(undefined)).toBe(false);
  });
});
