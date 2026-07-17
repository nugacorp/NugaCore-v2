// ====================================================================
// Tipos del dominio Payment Engine (Fase 4.8).
//
// Record = forma interna (store/DB).
// View   = forma saneada para API (sin secretos de proveedor).
// ====================================================================

export type PaymentProvider = 'manual' | 'mercado_pago' | 'openpay' | 'spei' | 'codi';

export type PaymentOrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled';

export type MikrotikActionType =
  | 'reactivate'
  | 'suspend'
  | 'speed_change'
  | 'disconnect'
  | 'custom';

export type MikrotikActionStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'skipped';

// ── Payment Order ─────────────────────────────────────────────────────

export interface PaymentOrderRecord {
  id: string;
  customerId: string;
  invoiceId: string;
  provider: PaymentProvider;
  providerOrderId?: string;
  amountCents: number;
  status: PaymentOrderStatus;
  checkoutUrl?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentOrderView {
  id: string;
  customerId: string;
  invoiceId: string;
  provider: PaymentProvider;
  providerOrderId?: string;
  amountPesos: number;
  status: PaymentOrderStatus;
  statusLabel: string;
  checkoutUrl?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const PAYMENT_ORDER_STATUS_LABELS: Record<PaymentOrderStatus, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  completed: 'Completado',
  failed: 'Fallido',
  expired: 'Expirado',
  cancelled: 'Cancelado',
};

// ── Payment Event ─────────────────────────────────────────────────────

export interface PaymentEventRecord {
  id: string;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  processed: boolean;
  paymentOrderId?: string;
  payload: Record<string, unknown>;
  receivedAt: string;
  processedAt?: string;
}

export interface PaymentEventView {
  id: string;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  processed: boolean;
  paymentOrderId?: string;
  receivedAt: string;
  processedAt?: string;
}

// ── Mikrotik Action ───────────────────────────────────────────────────

export interface MikrotikActionRecord {
  id: string;
  customerId: string;
  routerId?: string;
  actionType: MikrotikActionType;
  status: MikrotikActionStatus;
  dryRun: boolean;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  triggeredBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MikrotikActionView {
  id: string;
  customerId: string;
  routerId?: string;
  actionType: MikrotikActionType;
  status: MikrotikActionStatus;
  dryRun: boolean;
  result?: Record<string, unknown>;
  triggeredBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Resultado de procesamiento de webhook ─────────────────────────────

export interface WebhookProcessResult {
  eventId: string;
  idempotent: boolean;
  invoiceUpdated: boolean;
  reactivationTriggered: boolean;
  mikrotikActionId?: string;
  message: string;
}

// ── Resultado de reactivación lógica ─────────────────────────────────

export interface ReactivationResult {
  customerId: string;
  alreadyActive: boolean;
  mikrotikAction: MikrotikActionView | null;
  message: string;
}

// ── Input types ───────────────────────────────────────────────────────

export interface CreatePaymentOrderInput {
  customerId: string;
  invoiceId: string;
  provider: PaymentProvider;
  amountCents: number;
}

export interface ProcessWebhookInput {
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}
