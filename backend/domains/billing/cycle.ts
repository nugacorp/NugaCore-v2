// ====================================================================
// BillingCycleService — Facturación automática (FASE C, Billing Foundation).
//
// SIMULACIÓN PURA. No ejecuta cron real, no usa workers, no toca RouterOS.
// Proyecta qué facturas se generarían usando customers + plans (SSOT).
//
// POST /api/billing/run-cycle responde con:
//   wouldGenerate       — cuántas facturas se generarían (proyección)
//   generatedCount      — cuántas se generaron realmente (0 salvo commit explícito)
//   customersProcessed  — suscriptores evaluados
//
// `commit: true` crea facturas vía BillingService (mock o DB según flags).
// ====================================================================

import { logger } from '../../common/logger';
import { getCustomersService } from '../customers/service';
import { getPlansService } from '../plans/service';
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

  /** Proyecta las facturas que generaría el ciclo para la periodicidad dada (SSOT customers + plans). */
  async plan(period: BillingPeriod): Promise<BillingCyclePlannedInvoice[]> {
    const dueDate = todayPlus(BILLING_PERIOD_DAYS[period]);
    const planned: BillingCyclePlannedInvoice[] = [];

    const [clients, plans] = await Promise.all([
      getCustomersService().list({}),
      getPlansService().list({}),
    ]);

    for (const client of clients) {
      if (!BILLABLE_STATUSES.has(client.status)) continue;
      const plan = plans.find((p) => p.id === client.planId);
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

  /** Ejecuta un ciclo de facturación (simulación o commit explícito). */
  async runCycle(opts: { period?: unknown; commit?: unknown } = {}): Promise<BillingCycleResult> {
    const period = normalizeBillingPeriod(opts.period);
    const planned = await this.plan(period);
    const customersProcessed = (await getCustomersService().list({}))
      .filter((c) => BILLABLE_STATUSES.has(c.status)).length;

    const wantsCommit = opts.commit === true || opts.commit === 'true';

    let generatedCount = 0;
    if (wantsCommit) {
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
      logger.info(`BillingCycle: ${generatedCount} facturas creadas (commit) periodo=${period}`);
    } else {
      logger.info(`BillingCycle: simulación periodo=${period}, wouldGenerate=${planned.length}`);
    }

    return {
      period,
      generatedAt: new Date().toISOString(),
      committed: wantsCommit,
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
