import { describe, it, expect } from 'vitest';
import { store } from '../../backend/state/store';
import {
  getCustomerMetrics,
  getMrr,
  getBillingMetrics,
  getTicketMetrics,
  getTowerMetrics,
} from '../../backend/domains/system/metrics';
import {
  buildCheck,
  runDataConsistencyCheck,
} from '../../backend/domains/system/consistency';

// ====================================================================
// Unit — Data Consistency (Pre-PROD-7).
//
// Hermético (store en memoria, sin Supabase). Valida que:
//   1. El SSOT (systemMetrics) coincide con un recálculo directo del store.
//   2. El comparador del auditor distingue valores consistentes de los que no.
//   3. La auditoría completa reporta healthy:true con la data semilla.
// ====================================================================

const monthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

describe('systemMetrics — fuente única por KPI', () => {
  it('customers refleja exactamente los estatus del CRM (store.CLIENTS)', async () => {
    const m = await getCustomerMetrics();
    expect(m.active).toBe(store.CLIENTS.filter((c) => c.status === 'active').length);
    expect(m.suspended).toBe(store.CLIENTS.filter((c) => c.status === 'suspended').length);
    expect(m.leads).toBe(store.CLIENTS.filter((c) => c.status === 'lead').length);
    expect(m.offline).toBe(m.suspended + store.CLIENTS.filter((c) => c.status === 'baja').length);
  });

  it('MRR = suscripciones activas/suspendidas × precio de plan (una sola fórmula)', async () => {
    const priceById = new Map(store.PLANS.map((p) => [p.id, p.price]));
    const expected = store.CLIENTS.reduce(
      (acc, c) =>
        c.status === 'active' || c.status === 'suspended'
          ? acc + (priceById.get(c.planId) ?? 0)
          : acc,
      0,
    );
    expect(await getMrr()).toBe(Math.round(expected * 100) / 100);
  });

  it('billing usa el mes EN CURSO, no el histórico acumulado', async () => {
    const m = await getBillingMetrics();
    const month = monthKey(new Date());
    expect(m.month).toBe(month);

    const invoices = store.INVOICES.filter((inv) => inv.status !== 'canceled');
    const issued = invoices.filter((inv) => String(inv.dateStr || '').startsWith(month));
    const expectedFacturacion = Math.round(issued.reduce((s, inv) => s + inv.amount, 0) * 100) / 100;
    expect(m.facturacionMes).toBe(expectedFacturacion);

    // Garantía anti-regresión: NO debe ser la suma de TODO el histórico
    // (salvo que, por coincidencia, todas las facturas sean del mes actual).
    const allTime = invoices.reduce((s, inv) => s + inv.amount, 0);
    const issuedOutsideMonth = invoices.length !== issued.length;
    if (issuedOutsideMonth) {
      expect(m.facturacionMes).not.toBe(Math.round(allTime * 100) / 100);
    }
  });

  it('tickets y torres derivan de Support / Network (store)', async () => {
    const t = getTicketMetrics();
    expect(t.active).toBe(store.TICKETS.filter((tk) => tk.status !== 'resolved' && tk.status !== 'closed').length);
    expect(t.total).toBe(t.active + t.resolved);

    const tw = getTowerMetrics();
    expect(tw.online).toBe(store.TOWERS.filter((x) => x.status === 'online').length);
  });
});

describe('buildCheck — comparador del auditor', () => {
  it('marca consistent:false cuando un consumidor difiere de la fuente oficial', () => {
    const check = buildCheck('activeCustomers', 'CRM', 124, { dashboard: 126 });
    expect(check.consistent).toBe(false);
    expect(check.official).toBe(124);
    expect(check.consumers.dashboard).toBe(126);
  });

  it('marca consistent:true cuando todos los consumidores coinciden', () => {
    const check = buildCheck('cobradoMes', 'Billing', 1500.5, {
      dashboard: 1500.5,
      billingKpis: 1500.5,
    });
    expect(check.consistent).toBe(true);
  });

  it('tolera diferencias de redondeo monetario por debajo de 1 centavo', () => {
    const check = buildCheck('mrr', 'Billing', 1000.0, { dashboard: 1000.004 });
    expect(check.consistent).toBe(true);
  });
});

describe('runDataConsistencyCheck — auditoría completa', () => {
  it('reporta healthy:true y sin mismatches con la data semilla', async () => {
    const report = await runDataConsistencyCheck();
    expect(report.healthy).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(report.checks.every((c) => c.consistent)).toBe(true);
  });

  it('audita los KPIs críticos definidos en la auditoría', async () => {
    const report = await runDataConsistencyCheck();
    const metrics = report.checks.map((c) => c.metric);
    for (const expected of [
      'activeCustomers',
      'suspendedCustomers',
      'mrr',
      'facturacionMes',
      'cobradoMes',
      'facturasVencidas',
      'openTickets',
      'towersOnline',
    ]) {
      expect(metrics).toContain(expected);
    }
  });
});
