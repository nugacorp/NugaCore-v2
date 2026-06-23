// ====================================================================
// Tipos de contrato del dominio Billing & Collections (Billing Foundation).
//
// Este archivo concentra los modelos de NEGOCIO que expone el dominio
// (balance de cuenta, pagos como recurso, ciclo de facturación). NO
// redefine `Invoice`: la factura canónica vive en src/types.ts y se
// enriquece como `EnrichedInvoice` en mappers.ts. Aquí solo se agregan
// los contratos nuevos de la Foundation, manteniendo el DATA_CONTRACT:
//
//   API v1  ↔  store mock  ↔  Supabase (USE_DB_BILLING)
//
// Mapeo de nomenclatura (spec → implementación NugaCore):
//   customerId   → Invoice.clientId
//   customerName → Invoice.clientName
//   dueDate      → Invoice.dueDateStr  ('YYYY-MM-DD')
//   status       → Invoice.status      ('paid' | 'unpaid' | 'overdue' | 'canceled')
//   planId/planName → derivados del cliente + catálogo de planes
//   billingPeriod   → 'monthly' | 'biweekly' | 'weekly'
// ====================================================================

import type { Invoice } from '../../../src/types';

/** Estado canónico de factura en NugaCore (alineado con src/types.Invoice). */
export type BillingInvoiceStatus = Invoice['status']; // 'paid' | 'unpaid' | 'overdue' | 'canceled'

/** Periodicidad de facturación soportada por el ciclo. */
export type BillingPeriod = 'monthly' | 'biweekly' | 'weekly';

export const BILLING_PERIODS: BillingPeriod[] = ['monthly', 'biweekly', 'weekly'];

export const BILLING_PERIOD_DAYS: Record<BillingPeriod, number> = {
  monthly: 30,
  biweekly: 15,
  weekly: 7,
};

// ── AccountBalance ────────────────────────────────────────────────────
// Respuesta de GET /api/billing/customers/:customerId/balance.
// currentBalance  = total pendiente (todas las facturas no canceladas).
// overdueBalance  = pendiente solo de facturas vencidas (status overdue).
// totalBalance    = alias de currentBalance (compat con la spec).

export interface AccountBalance {
  customerId: string;
  customerName: string;
  currentBalance: number;
  overdueBalance: number;
  totalBalance: number;
  pendingInvoices: number;
  overdueInvoices: number;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
}

// ── Payment (recurso) ─────────────────────────────────────────────────
// Forma de pago expuesta por GET /api/billing/payments y POST /api/billing/payments.
// Es una proyección de las aplicaciones de pago (PaymentAllocation / payments).

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  customerId: string;
  customerName: string;
  amount: number;
  paymentDate: string;
  paymentMethod: string;
  reference: string | null;
}

/** Cuerpo aceptado por POST /api/billing/payments. */
export interface CreatePaymentBody {
  invoiceId?: unknown;
  amount?: unknown;
  paymentMethod?: unknown;
  method?: unknown;          // alias retrocompatible
  reference?: unknown;
  transactionId?: unknown;   // alias retrocompatible
}

/** Cuerpo aceptado por POST /api/billing/invoices/:id/cancel. */
export interface CancelInvoiceBody {
  reason?: unknown;
}

// ── Billing Cycle (FASE C) ────────────────────────────────────────────
// Simulación de facturación automática. NO ejecuta cron real ni workers;
// solo proyecta qué facturas se generarían.

export interface BillingCycleRequestBody {
  period?: unknown;   // 'monthly' | 'biweekly' | 'weekly' (default monthly)
  commit?: unknown;   // si true, además crea las facturas en el repo (mock)
}

export interface BillingCyclePlannedInvoice {
  customerId: string;
  customerName: string;
  planId: string;
  planName: string;
  amount: number;
  dueDate: string;
  billingPeriod: BillingPeriod;
}

export interface BillingCycleResult {
  period: BillingPeriod;
  generatedAt: string;
  committed: boolean;
  customersProcessed: number;
  wouldGenerate: number;
  generatedCount: number;
  planned: BillingCyclePlannedInvoice[];
}
