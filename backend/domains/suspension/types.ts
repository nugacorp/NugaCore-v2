// ====================================================================
// Tipos y enums del Motor de Suspensiones (Fase 4.5).
//
// El motor DECIDE y emite ÓRDENES. No ejecuta acciones ni toca MikroTik.
// ====================================================================

/** Estado de servicio (la "decisión" del motor, separada del estado de red). */
export type ServiceStatus =
  | 'ACTIVE'
  | 'WARNING'
  | 'PENDING_SUSPENSION'
  | 'SUSPENDED'
  | 'PENDING_REACTIVATION';

/** Estado de cobranza derivado de las facturas del cliente. */
export type BillingStatus = 'CURRENT' | 'DUE_SOON' | 'OVERDUE' | 'DELINQUENT';

/** Estado de una orden (la ejecutará el Worker en una fase futura). */
export type OrderStatus = 'PENDING' | 'QUEUED' | 'EXECUTED' | 'FAILED' | 'CANCELLED';

export type OrderType = 'suspension' | 'reactivation';

export type SuspensionOrderSource =
  | 'engine'
  | 'manual'
  | 'payment-engine'
  | 'provisioning-center'
  | 'service-status';

export type SuspensionEventType =
  | 'evaluated'
  | 'state_changed'
  | 'suspension_order_created'
  | 'reactivation_order_created'
  | 'order_cancelled';

export const OPEN_ORDER_STATUSES: OrderStatus[] = ['PENDING', 'QUEUED'];

// ── Política ───────────────────────────────────────────────────────────
export interface SuspensionPolicyV2 {
  id: string;
  name: string;
  enabled: boolean;
  graceDays: number;
  suspendAfterDue: boolean;
  reactivateOnPayment: boolean;
  reactivateOnPartialPayment: boolean;
  autoReactivate: boolean;
  /** Días antes del vencimiento para marcar DUE_SOON. */
  dueSoonDays: number;
  updatedAt: string;
}

export const DEFAULT_SUSPENSION_POLICY: SuspensionPolicyV2 = {
  id: 'default',
  name: 'Política de cobranza por defecto',
  enabled: true,
  graceDays: 3,
  suspendAfterDue: true,
  reactivateOnPayment: true,
  reactivateOnPartialPayment: false,
  autoReactivate: true,
  dueSoonDays: 3,
  updatedAt: new Date().toISOString(),
};

// ── Estado por cliente ─────────────────────────────────────────────────
export interface CustomerServiceState {
  customerId: string;
  customerName: string;
  serviceStatus: ServiceStatus;
  billingStatus: BillingStatus;
  networkStatus: string; // espejo de Client.status
  lastEvaluatedAt: string;
  lastSuspensionAt?: string;
  lastReactivationAt?: string;
  currentReason?: string;
  updatedAt: string;
}

// ── Evento ─────────────────────────────────────────────────────────────
export interface SuspensionEvent {
  id: string;
  customerId: string;
  invoiceId?: string;
  eventType: SuspensionEventType;
  reason?: string;
  automatic: boolean;
  actorId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  /** Identidad durable del efecto de webhook (T5); nula fuera de ese flujo. */
  tenantId?: string;
  idempotencyKey?: string;
}

// ── Órdenes ────────────────────────────────────────────────────────────
export interface SuspensionOrder {
  id: string;
  customerId: string;
  /** Scope obligatorio para órdenes creadas por Payments; legacy puede omitirlo. */
  tenantId?: string;
  /** Router ya validado por el productor de la orden. */
  routerId?: string;
  invoiceId?: string;
  orderType: OrderType;
  status: OrderStatus;
  source: SuspensionOrderSource;
  reason?: string;
  scheduledFor?: string;
  executedAt?: string;
  createdAt: string;
  /** Identidad durable del efecto de webhook (T5); nula fuera de ese flujo. */
  idempotencyKey?: string;
  // ── Worker dry-run (Fase 4.6) ─────────────────────────────────────
  dryRun?: boolean;
  workerRunId?: string;
  workerNote?: string;
}

/** Parche que el Worker aplica a una orden tras procesarla (dry-run). */
export interface OrderUpdate {
  status?: OrderStatus;
  executedAt?: string;
  dryRun?: boolean;
  workerRunId?: string;
  workerNote?: string;
}

// ── Resultado de evaluación ────────────────────────────────────────────
export interface EvaluationResult {
  customerId: string;
  customerName: string;
  previousServiceStatus: ServiceStatus | null;
  serviceStatus: ServiceStatus;
  billingStatus: BillingStatus;
  networkStatus: string;
  changed: boolean;
  action: 'none' | 'create_suspension' | 'create_reactivation';
  orderId?: string;
  reason: string;
  invoiceId?: string;
}
