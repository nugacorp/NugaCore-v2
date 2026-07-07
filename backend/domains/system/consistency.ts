// ====================================================================
// Data Consistency Auditor (Pre-PROD-7).
//
// Verifica que los KPIs PUBLICADOS por los endpoints del dashboard/cobranza
// coincidan con la FUENTE OFICIAL de cada métrica. Es un guard de regresión:
// recalcula cada KPI de forma INDEPENDIENTE leyendo la fuente cruda (CRM,
// Billing, Support, Network) y lo compara contra lo que `/api/dashboard-stats`
// y `/api/dashboard/billing-kpis` realmente devuelven.
//
// Si alguien reintroduce un cálculo divergente (p.ej. "facturación del mes"
// sumando el histórico completo), este auditor lo detecta y devuelve
// healthy:false con el detalle del desajuste.
//
// Read-only y sin efectos: no muta estado, no ejecuta el motor de
// suspensiones, no toca RouterOS/MikroTik.
// ====================================================================

import { getCustomersService } from '../customers/service';
import { getPlansService } from '../plans/service';
import { getBillingService } from '../billing/service';
import { getSupportService } from '../tickets/service';
import { getNetworkService } from '../network/service';
import { countSuspended } from '../service-status/service';
import { buildDashboardStats, buildBillingKpis } from '../dashboard/routes';

const MONEY_EPSILON = 0.01;
const round = (v: number): number => Math.round(v * 100) / 100;
const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export interface ConsistencyCheck {
  /** Identificador del KPI auditado. */
  metric: string;
  /** Módulo dueño de la fuente oficial. */
  source: string;
  /** Valor recalculado desde la fuente oficial (independiente). */
  official: number;
  /** Valor que cada consumidor publica para ese KPI. */
  consumers: Record<string, number>;
  consistent: boolean;
}

export interface ConsistencyMismatch {
  metric: string;
  source: string;
  official: number;
  /** Consumidores cuyo valor difiere de la fuente oficial. */
  diverging: Record<string, number>;
}

export interface DataConsistencyReport {
  healthy: boolean;
  checkedAt: string;
  modules: string[];
  checks: ConsistencyCheck[];
  mismatches: ConsistencyMismatch[];
}

/** Recalcula cada KPI auditado directamente desde su fuente oficial. */
async function officialValues() {
  const [clients, allInvoices] = await Promise.all([
    getCustomersService().list({}),
    getBillingService().listInvoices(),
  ]);
  const invoices = allInvoices.filter((inv) => inv.status !== 'canceled');
  const month = monthKey(new Date());
  const issuedThisMonth = invoices.filter((inv) => String(inv.dateStr || '').startsWith(month));
  const plans = await getPlansService().list({});
  const priceById = new Map(plans.map((p) => [p.id, p.price]));

  const tickets = await getSupportService().listTickets({});
  const towers = await getNetworkService().listTowers({ status: 'online' });

  return {
    activeCustomers: clients.filter((c) => c.status === 'active').length,
    // Suspendidos: FUENTE OFICIAL Service Status (serviceStatus SUSPENDED),
    // recalculado de forma independiente desde su SSOT.
    suspendedCustomers: await countSuspended(),
    leads: clients.filter((c) => c.status === 'lead').length,
    mrr: round(
      clients.reduce(
        (acc, c) =>
          c.status === 'active' || c.status === 'suspended'
            ? acc + (priceById.get(c.planId) ?? 0)
            : acc,
        0,
      ),
    ),
    facturacionMes: round(issuedThisMonth.reduce((s, inv) => s + inv.amount, 0)),
    cobradoMes: round(issuedThisMonth.reduce((s, inv) => s + (inv.paidAmount || 0), 0)),
    pendienteCobro: round(invoices.reduce((s, inv) => s + (inv.pendingAmount || 0), 0)),
    facturasVencidas: invoices.filter((inv) => inv.status === 'overdue').length,
    openTickets: tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length,
    towersOnline: towers.length,
  };
}

export const buildCheck = (
  metric: string,
  source: string,
  official: number,
  consumers: Record<string, number>,
): ConsistencyCheck => {
  const consistent = Object.values(consumers).every(
    (value) => Math.abs(value - official) <= MONEY_EPSILON,
  );
  return { metric, source, official: round(official), consumers, consistent };
};

/**
 * Ejecuta la auditoría completa de consistencia de KPIs.
 * GET /api/system/data-consistency consume esta función.
 */
export async function runDataConsistencyCheck(): Promise<DataConsistencyReport> {
  const [official, dashboard, billingKpis] = await Promise.all([
    officialValues(),
    buildDashboardStats(),
    buildBillingKpis(),
  ]);

  const checks: ConsistencyCheck[] = [
    buildCheck('activeCustomers', 'CRM', official.activeCustomers, {
      dashboard: dashboard.activeClients,
    }),
    buildCheck('suspendedCustomers', 'ServiceStatus', official.suspendedCustomers, {
      dashboard: dashboard.suspendedClients,
    }),
    buildCheck('leads', 'CRM', official.leads, {
      dashboard: dashboard.leadsCount,
    }),
    buildCheck('mrr', 'Billing', official.mrr, {
      dashboard: dashboard.mrr,
    }),
    buildCheck('facturacionMes', 'Billing', official.facturacionMes, {
      dashboard: dashboard.facturacionMes,
      billingKpis: billingKpis.facturacionMes,
    }),
    buildCheck('cobradoMes', 'Billing', official.cobradoMes, {
      dashboard: dashboard.cobranzaMes,
      billingKpis: billingKpis.cobradoMes,
    }),
    buildCheck('pendienteCobro', 'Billing', official.pendienteCobro, {
      billingKpis: billingKpis.pendienteCobro,
    }),
    buildCheck('facturasVencidas', 'Billing', official.facturasVencidas, {
      billingKpis: billingKpis.facturasVencidas,
    }),
    buildCheck('openTickets', 'Support', official.openTickets, {
      dashboard: dashboard.activeTickets,
    }),
    buildCheck('towersOnline', 'Network', official.towersOnline, {
      dashboard: dashboard.towers.online,
    }),
  ];

  const mismatches: ConsistencyMismatch[] = checks
    .filter((c) => !c.consistent)
    .map((c) => ({
      metric: c.metric,
      source: c.source,
      official: c.official,
      diverging: Object.fromEntries(
        Object.entries(c.consumers).filter(
          ([, value]) => Math.abs(value - c.official) > MONEY_EPSILON,
        ),
      ),
    }));

  return {
    healthy: mismatches.length === 0,
    checkedAt: new Date().toISOString(),
    modules: ['CRM', 'ServiceStatus', 'Billing', 'Support', 'Network', 'IPAM', 'Inventory'],
    checks,
    mismatches,
  };
}
