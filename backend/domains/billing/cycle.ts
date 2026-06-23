// ====================================================================
// BillingCycleService — Facturación automática (FASE C, Billing Foundation).
//
// SIMULACIÓN PURA. No ejecuta cron real, no usa workers, no toca RouterOS.
// Proyecta qué facturas se generarían para los suscriptores activos según
// la periodicidad (mensual / quincenal / semanal) usando el catálogo mock
// (store.CLIENTS + store.PLANS).
//
// POST /api/billing/run-cycle responde con:
//   wouldGenerate       — cuántas facturas se generarían (proyección)
//   generatedCount      — cuántas se generaron realmente (0 salvo commit en mock)
//   customersProcessed  — suscriptores evaluados
//
// `commit: true` SOLO surte efecto en modo mock (USE_DB_BILLING=false): crea
// las facturas en el store. En modo DB la simulación nunca escribe (controlado).
// ====================================================================

import { store } from '../../state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { logger } from '../../common/logger';
import { BillingService, getBillingService } from './service';
import {
  BILLING_PERIOD_DAYS,
  BILLING_PERIODS,
  BillingCyclePlannedInvoice,
  BillingCycleResult,
  BillingPeriod,
} from './types';

// Estados de cliente que constituyen un suscriptor facturable.
const BILLABLE_STATUSES = new Set(['active', 'suspended']);

const todayPlus = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

export const normalizeBillingPeriod = (value: unknown): BillingPeriod => {
  const raw = String(value ?? '').trim().toLowerCase();
  return (BILLING_PERIODS as string[]).includes(raw) ? (raw as BillingPeriod) : 'monthly';
};

export class BillingCycleService {
  constructor(private readonly billing: BillingService) {}

  /** Proyecta las facturas que generaría el ciclo para la periodicidad dada. */
  plan(period: BillingPeriod): BillingCyclePlannedInvoice[] {
    const dueDate = todayPlus(BILLING_PERIOD_DAYS[period]);
    const planned: BillingCyclePlannedInvoice[] = [];

    for (const client of store.CLIENTS) {
      if (!BILLABLE_STATUSES.has(client.status)) continue;
      const plan = store.PLANS.find((p) => p.id === client.planId);
      if (!plan || !(plan.price > 0)) continue;

      planned.push({
        customerId: client.id,
        customerName: client.name,
        planId: plan.id,
        planName: plan.name,
        amount: plan.price,
        dueDate,
        billingPeriod: period,
      });
    }
    return planned;
  }

  /** Ejecuta (simula) un ciclo de facturación. */
  async runCycle(opts: { period?: unknown; commit?: unknown } = {}): Promise<BillingCycleResult> {
    const period = normalizeBillingPeriod(opts.period);
    const planned = this.plan(period);
    const customersProcessed = store.CLIENTS.filter((c) => BILLABLE_STATUSES.has(c.status)).length;

    // commit solo en modo mock: nunca escribe contra la DB desde la simulación.
    const wantsCommit = opts.commit === true || opts.commit === 'true';
    const canCommit = wantsCommit && !isDomainOnDb('billing');

    let generatedCount = 0;
    if (canCommit) {
      for (const item of planned) {
        await this.billing.createInvoice({
          clientId: item.customerId,
          clientName: item.customerName,
          amount: item.amount,
          dueDateStr: item.dueDate,
          items: [{ description: `${item.planName} — ciclo ${period}`, price: item.amount, qty: 1 }],
        });
        generatedCount += 1;
      }
      logger.info(`BillingCycle: ${generatedCount} facturas creadas (mock, commit) periodo=${period}`);
    } else {
      logger.info(`BillingCycle: simulación periodo=${period}, wouldGenerate=${planned.length}`);
    }

    return {
      period,
      generatedAt: new Date().toISOString(),
      committed: canCommit,
      customersProcessed,
      wouldGenerate: planned.length,
      generatedCount,
      planned,
    };
  }
}

let singleton: BillingCycleService | null = null;

export const getBillingCycleService = (): BillingCycleService => {
  if (!singleton) singleton = new BillingCycleService(getBillingService());
  return singleton;
};
