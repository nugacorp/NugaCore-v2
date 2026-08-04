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
  tenantId?: string;
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
  tenantId?: string;
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
  tenantId?: string;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  processed: boolean;
  paymentOrderId?: string;
  /** Canonical Billing payment used to authorize checkpoints across deliveries. */
  webhookPaymentId?: string;
  payload: Record<string, unknown>;
  receivedAt: string;
  processedAt?: string;
  /**
   * Instante en que una entrega reservó el evento. Junto a `processed` define
   * el lease: mientras esté vigente, ninguna otra entrega puede procesarlo.
   */
  claimedAt?: string;
  /**
   * Epoch opaco del dueño actual. Cada claim/reclaim genera uno nuevo; un
   * procesador con un token anterior ya no puede renovar ni cerrar la fila.
   */
  claimToken?: string;
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
  tenantId?: string;
  customerId: string;
  routerId?: string;
  actionType: MikrotikActionType;
  status: MikrotikActionStatus;
  dryRun: boolean;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  triggeredBy?: string;
  /**
   * Vínculo durable con el evento que originó la acción. `triggered_by` es
   * texto libre y no sirve como vínculo verificable por la base: la RPC de
   * checkpoint valida ESTE campo antes de tocar el progreso.
   * Nulo en acciones manuales.
   */
  paymentEventId?: string;
  /** Canonical Billing payment that owns this durable reactivation family. */
  webhookPaymentId?: string;
  /**
   * Identidad de la acción raíz, tenant-scoped. Nula en acciones manuales y en
   * filas históricas: la unicidad es un índice PARCIAL.
   */
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MikrotikActionView {
  id: string;
  tenantId?: string;
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
  /**
   * Por qué no se reprocesó: ya estaba procesado, o hay otra entrega del mismo
   * evento en curso (claim vivo). Solo presente cuando `idempotent` es true.
   */
  idempotentReason?: 'already_processed' | 'in_progress';
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

/**
 * Barrera que autoriza cada efecto mutante de una reactivación iniciada por
 * webhook. La ruta manual omite este campo y conserva su contrato sin claim.
 *
 * Lleva además la identidad del claim porque el checkpoint y la operación
 * Billing ya no son escrituras "a ciegas": la base valida el owner vigente.
 */
export interface WebhookMutationFence {
  beforeMutation(): Promise<void>;
  /** Fila durable del evento; raíz de todas las identidades del flujo. */
  eventId: string;
  /** Epoch del owner actual; sin él no se autoriza ningún checkpoint. */
  claimToken: string;
  /** Filled after Billing resolves the canonical charge and before reactivation. */
  canonicalPaymentId?: string;
}

// ── Checkpoint de reactivación ────────────────────────────────────────

/** Whitelist cerrada: la RPC rechaza cualquier paso fuera de esta lista. */
export const WEBHOOK_REACTIVATION_STEPS = [
  'customerReactivated',
  'timelineAdded',
  'networkDispatched',
  'suspensionEventRecorded',
  'alertCreated',
] as const;

export type WebhookReactivationStep = typeof WEBHOOK_REACTIVATION_STEPS[number];

export type WebhookReactivationProgress = Partial<Record<WebhookReactivationStep, true>>;

/** Clave bajo la que vive el progreso dentro de `mikrotik_actions.result`. */
export const WEBHOOK_REACTIVATION_PROGRESS_KEY = '_webhookReactivationProgress';

/**
 * Estados exhaustivos del checkpoint. Cualquier otra cosa —RPC ausente, 0 o
 * varias filas, error de base, respuesta desconocida— es un error retryable
 * que nunca permite cerrar el evento.
 */
export type CheckpointStepOutcome = 'applied' | 'already_applied' | 'ownership_lost';

export interface CheckpointStepInput {
  tenantId: string;
  eventId: string;
  actionId: string;
  claimToken: string;
  step: WebhookReactivationStep;
}

export interface IdempotentActionResult {
  outcome: 'created' | 'existing';
  action: MikrotikActionRecord;
}

export interface ReactivationContext {
  triggeredBy?: string;
  invoiceId?: string;
  tenantId?: string;
  webhookFence?: WebhookMutationFence;
}

// ── Input types ───────────────────────────────────────────────────────

export interface CreatePaymentOrderInput {
  customerId: string;
  invoiceId: string;
  provider: PaymentProvider;
  amountCents: number;
  tenantId?: string;
}

export interface ProcessWebhookInput {
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /**
   * WISP dueño del evento. OBLIGATORIO: acota la idempotencia y la búsqueda de
   * order. Dos merchants distintos pueden reutilizar el mismo
   * provider_event_id, y el evento de un WISP nunca debe tocar la order de
   * otro. La ruta legacy single-WISP pasa `DEFAULT_TENANT_ID` explícitamente.
   */
  tenantId: string;
}
