// ====================================================================
// Servicio Payment Engine (Fase 4.8).
//
// Responsabilidades:
//   1. Crear payment_orders (checkout desacoplado de proveedor).
//   2. Procesar webhooks con idempotencia por (provider, providerEventId).
//   3. Integrar con Billing: marcar invoice paid + registrar pago.
//   4. Reactivación LÓGICA (dry_run=true): crea mikrotik_action, NO
//      ejecuta en router real. El Worker real lo ejecutará en Fase futura.
//
// RESTRICCIONES:
//   - NO commit mode en MikroTik. NO routers reales. NO PPP reales.
//   - Idempotente: el mismo webhook procesado 2 veces no duplica nada.
// ====================================================================

import { logger } from '../../common/logger';
import {
  BadRequestError,
  IdempotencyConflictError,
  NotFoundError,
  opaqueFingerprint,
  ServiceUnavailableError,
} from '../../common/errors';
import { productionGates } from '../../config/production-gates';
import {
  createOrGetNetworkOrder,
  processNetworkOrder,
} from '../../bridges/network-order-dispatch';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getBillingService } from '../billing/service';
import {
  webhookPaymentAmountCents,
  type EnrichedInvoice,
  type WebhookPaymentResult,
} from '../billing/repository';
import { getCustomersService } from '../customers/service';
import { getSuspensionService } from '../suspension/service';
import { inventoryRoutersRepository } from '../inventory/routers/repository';
import { filterRoutersByTenant, findRouterForTenant } from '../mikrotik/tenant-filter';
import { store } from '../../state/store';
import { buildPaymentDataProvider } from './data-provider';
import { resolveProvider } from './providers/index';
import {
  StorePaymentRepository,
  SupabasePaymentRepository,
  PaymentRepository,
  requireTenantId,
} from './repository';
import { getAlertSink } from '../noc/alert-sink';
import {
  CreatePaymentOrderInput,
  AutomaticReactivationDecision,
  MikrotikActionRecord,
  MikrotikActionView,
  PaymentEventRecord,
  PaymentOrderRecord,
  PaymentProvider,
  ProcessWebhookInput,
  ReactivationContext,
  ReactivationResult,
  TenantOwned,
  WEBHOOK_REACTIVATION_PROGRESS_KEY,
  WEBHOOK_REACTIVATION_STEPS,
  WebhookMutationFence,
  WebhookProcessResult,
  WebhookReactivationProgress,
  WebhookReactivationStep,
} from './types';
import {
  rootActionIdempotencyKey,
  stepIdempotencyKey,
  webhookPaymentIdempotencyKey,
} from './idempotency';
import {
  clearFinancialSuspensionBlocksForDecision,
  evaluateAutomaticPaymentReactivation,
  recordAutomaticReactivationDecision,
} from './automatic-reactivation';
import { assertWebhookCapability } from './webhook-capability';
import {
  mikrotikActionToView,
  paymentOrderToView,
} from './mappers';

import { nowIso } from '../../common/time';

// ── Helpers ───────────────────────────────────────────────────────────

const VALID_PROVIDERS: PaymentProvider[] = ['manual', 'mercado_pago', 'openpay', 'spei', 'codi'];

const assertValidProvider = (p: unknown): PaymentProvider => {
  if (!VALID_PROVIDERS.includes(p as PaymentProvider)) {
    throw new BadRequestError(`Proveedor de pago inválido: ${p}. Válidos: ${VALID_PROVIDERS.join(', ')}`);
  }
  return p as PaymentProvider;
};

class ClaimOwnershipLostError extends Error {
  constructor() {
    super('Webhook claim ownership lost');
    this.name = 'ClaimOwnershipLostError';
  }
}

const isInvoiceSettled = (invoice: EnrichedInvoice | null | undefined): invoice is EnrichedInvoice =>
  invoice?.status === 'paid' && invoice.pendingAmount <= 0;

const readWebhookReactivationProgress = (
  action: MikrotikActionRecord,
): WebhookReactivationProgress => {
  const raw = action.result?.[WEBHOOK_REACTIVATION_PROGRESS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const progress: WebhookReactivationProgress = {};
  for (const step of WEBHOOK_REACTIVATION_STEPS) {
    if (record[step] === true) progress[step] = true;
  }
  return progress;
};

// ── Servicio ──────────────────────────────────────────────────────────

export class PaymentService {
  constructor(private readonly repo: PaymentRepository) {}

  /**
   * Barrera de fencing compartida por todos los efectos del webhook. Renueva
   * el lease y aborta inmediatamente si otro procesador ya rotó el epoch.
   */
  private async renewOrThrow(eventId: string, tenantId: string, claimToken: string | undefined): Promise<void> {
    if (!claimToken || !await this.repo.renewEventClaim(eventId, tenantId, claimToken)) {
      throw new ClaimOwnershipLostError();
    }
  }

  private async shouldRunAutomaticReactivation(
    decision: AutomaticReactivationDecision | undefined,
  ): Promise<boolean> {
    if (!decision) return false;
    if (decision.eligible) return true;
    const existing = await this.repo.findActionByIdempotencyKey(
      decision.tenantId,
      decision.reactivationIdempotencyKey,
    );
    if (existing) return true;
    const existingOrder = await getSuspensionService().repo.findReactivationOrderByIdempotencyKey(
      decision.tenantId,
      decision.reactivationIdempotencyKey,
    );
    if (!existingOrder) return false;
    return decision.outcome === 'already_active'
      || (decision.outcome === 'blocked_non_financial' && decision.blockReasonCategory === 'unknown');
  }

  private async recordAutomaticReactivationDecisionOnce(
    decision: AutomaticReactivationDecision | undefined,
    shouldReactivate: boolean,
  ): Promise<void> {
    if (!decision) return;
    if (shouldReactivate && !decision.eligible) return;
    await recordAutomaticReactivationDecision(decision);
  }

  /** El cierre sigue siendo un CAS condicionado por el mismo epoch. */
  private async closeOrThrow(eventId: string, tenantId: string, claimToken: string | undefined): Promise<void> {
    if (!claimToken || !await this.repo.markEventProcessed(eventId, tenantId, claimToken)) {
      throw new ClaimOwnershipLostError();
    }
  }

  // ── Payment Orders ────────────────────────────────────────────────

  async listOrders(filter: { tenantId: string; customerId?: string; invoiceId?: string }) {
    const orders = await this.repo.listOrders({
      ...filter,
      tenantId: requireTenantId(filter.tenantId, 'listOrders'),
    });
    return orders.map(paymentOrderToView);
  }

  async getOrder(id: string, tenantId: string) {
    const order = await this.repo.findOrderById(id, requireTenantId(tenantId, 'getOrder'));
    return order ? paymentOrderToView(order) : null;
  }

  async createOrder(input: CreatePaymentOrderInput) {
    if (!input.customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');
    if (!input.invoiceId?.trim()) throw new BadRequestError('invoiceId es obligatorio.');
    const provider = assertValidProvider(input.provider);
    const tenantId = requireTenantId(input.tenantId, 'createOrder');

    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestError('amountCents debe ser un entero positivo (centavos).');
    }

    // Validar que cliente y factura existen y pertenecen al tenant
    const customer = await getCustomersService().getById(input.customerId, tenantId);
    if (!customer) throw new BadRequestError(`Cliente '${input.customerId}' no encontrado.`);

    const invoice = await getBillingService().findInvoiceById(input.invoiceId, tenantId);
    if (!invoice) throw new BadRequestError(`Factura '${input.invoiceId}' no encontrada.`);
    if (invoice.clientId !== input.customerId) {
      throw new BadRequestError(
        'La factura no pertenece al cliente indicado.',
        'INVOICE_CLIENT_MISMATCH',
      );
    }

    // Credenciales del WISP dueño de la order (OpenPay/SPEI); sin ellas, simulado.
    const providerImpl = await resolveProvider(provider, tenantId);

    const id = await this.repo.nextOrderId();
    const now = nowIso();

    const orderResp = await providerImpl.createPaymentOrder({
      orderId: id,
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      amountCents: input.amountCents,
    });

    const rec: TenantOwned<PaymentOrderRecord> = {
      id,
      tenantId,
      customerId: input.customerId,
      invoiceId: input.invoiceId,
      provider,
      providerOrderId: orderResp.providerOrderId,
      amountCents: input.amountCents,
      status: 'pending',
      checkoutUrl: orderResp.checkoutUrl,
      expiresAt: orderResp.expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.createOrder(rec);
    logger.info('PaymentEngine: order creada', { orderId: id, provider, invoiceId: input.invoiceId, tenantId });
    return paymentOrderToView(rec);
  }

  // ── Webhook processing ────────────────────────────────────────────

  async processWebhook(input: ProcessWebhookInput): Promise<WebhookProcessResult> {
    const { provider, providerEventId, eventType, payload } = input;
    const tenantId = requireTenantId(input.tenantId, 'processWebhook');

    // ANTES de reclamar nada: un tuple Payments/Billing incoherente o un
    // schema sin las RPC/constraints de T5 no puede sostener la garantía.
    // Falla cerrado (503 retryable) en vez de degradar a la ruta insegura.
    await assertWebhookCapability();

    // Idempotencia POR TENANT mediante CLAIM atómico: dos merchants pueden
    // reutilizar el mismo provider_event_id (solo colisiona dentro del mismo
    // WISP), y dos entregas simultáneas del mismo evento no pueden procesarse
    // las dos — solo la que se lleva el claim continúa.
    const eventRec: TenantOwned<PaymentEventRecord> = {
      id: await this.repo.nextEventId(),
      tenantId,
      provider,
      providerEventId,
      eventType,
      processed: false,
      payload,
      receivedAt: nowIso(),
    };
    const claim = await this.repo.claimEvent(eventRec);

    if (claim.outcome !== 'claimed') {
      const alreadyProcessed = claim.outcome === 'already_processed';
      logger.info('PaymentEngine: webhook no reprocesado (idempotente)', {
        provider, eventFingerprint: opaqueFingerprint(providerEventId), tenantId, reason: claim.outcome,
      });
      return {
        eventId: claim.event.id,
        idempotent: true,
        idempotentReason: claim.outcome,
        invoiceUpdated: false,
        reactivationTriggered: false,
        message: alreadyProcessed
          ? 'Evento ya procesado anteriormente.'
          : 'Evento en proceso por otra entrega del mismo webhook.',
      };
    }

    // Id real del evento reservado: al recuperar un claim abandonado se
    // continúa sobre la fila existente, no sobre la candidata.
    const eventId = claim.event.id;
    // En un reclaim la fila persistida es la fuente de auditoría. Una
    // reentrega divergente con la misma identidad no puede cambiar qué evento
    // se aprueba ni qué order se busca sin actualizar atómicamente esa fila.
    const claimedEventType = claim.event.eventType;
    const claimedPayload = claim.event.payload;
    const claimToken = claim.event.claimToken;
    const lostOwnershipResult = (): WebhookProcessResult => ({
      eventId,
      idempotent: true,
      idempotentReason: 'in_progress',
      invoiceUpdated: false,
      reactivationTriggered: false,
      message: 'El claim cambió de dueño; esta entrega debe reintentarse.',
    });
    try {
      // Un claim sin epoch no puede autorizar checkpoints ni la RPC Billing:
      // sin token no hay forma de demostrar ownership, así que no se procesa.
      if (!claimToken) throw new ClaimOwnershipLostError();
      // Fencing temprano: un procesador que despertó después de que otro
      // reclamara el lease no llega siquiera a las lecturas que preceden efectos.
      await this.renewOrThrow(eventId, tenantId, claimToken);

      // Solo eventos de pago aprobado disparan el flujo completo
      const isApproved = this.isApprovedEvent(provider, claimedEventType, claimedPayload);
      if (!isApproved) {
        await this.closeOrThrow(eventId, tenantId, claimToken);
        logger.info('PaymentEngine: webhook recibido (no aprobado, no acción)', {
          provider, eventType: claimedEventType, tenantId,
        });
        return {
          eventId, idempotent: false, invoiceUpdated: false,
          reactivationTriggered: false, message: 'Evento recibido, sin acción (no es aprobación de pago).',
        };
      }

      // CoDi entrega el importe en el propio webhook. Si viene presente debe
      // validarse antes de cualquier lookup/adapter; los valores ausentes se
      // resuelven despues contra order/factura y se vuelven a validar en Billing.
      if (provider === 'codi') {
        const rawAmount = claimedPayload.amount ?? claimedPayload.monto;
        if (rawAmount !== undefined && rawAmount !== null) {
          webhookPaymentAmountCents(Number(rawAmount));
        }
      }

      // Buscar payment_order por providerOrderId DENTRO del WISP del evento: un
      // provider_order_id de otro merchant nunca puede completar esta order.
      const providerOrderId = this.extractProviderOrderId(provider, claimedPayload);
      let order = providerOrderId
        ? await this.repo.findOrderByProviderOrderId(provider, providerOrderId, tenantId)
        : null;
      if (!order && provider === 'codi' && providerOrderId) {
        const normalizedReference = providerOrderId.trim().toUpperCase();
        const matchingOrders = (await this.repo.listOrders({ tenantId })).filter(
          (candidate) => candidate.provider === 'codi'
            && (
              candidate.providerOrderId?.trim().toUpperCase() === normalizedReference
              || `${candidate.invoiceId}-${candidate.customerId}`.trim().toUpperCase()
                === normalizedReference
            ),
        );
        if (matchingOrders.length > 1) {
          throw new ServiceUnavailableError(
            'La referencia CoDi coincide con multiples ordenes.',
            'CODI_REFERENCE_AMBIGUOUS',
          );
        }
        order = matchingOrders[0] ?? null;
      }

      let invoiceUpdated = false;
      let reactivationTriggered = false;
      let mikrotikActionId: string | undefined;

      if (order) {
        const orderTenantId = order.tenantId || 'tenant-default';
        // Cada llamada mutante tiene su propia barrera: perder ownership dentro
        // de un efecto impide alcanzar el siguiente.
        await this.renewOrThrow(eventId, tenantId, claimToken);
        await this.repo.updateOrderStatus(order.id, orderTenantId, 'completed');

        await this.renewOrThrow(eventId, tenantId, claimToken);
        const webhookFence: WebhookMutationFence = {
          beforeMutation: () => this.renewOrThrow(eventId, tenantId, claimToken),
          eventId,
          claimToken,
        };
        const invoiceResult = await this.confirmPaymentOnInvoice(order, orderTenantId, webhookFence);
        invoiceUpdated = invoiceResult.updated;

        if (invoiceResult.shouldReactivate) {
          await this.renewOrThrow(eventId, tenantId, claimToken);
          if (invoiceResult.reactivationDecision) {
            await clearFinancialSuspensionBlocksForDecision(
              invoiceResult.reactivationDecision,
              `webhook:${provider}:${opaqueFingerprint(providerEventId)}`,
            );
          }
          const reactivation = await this.reactivateCustomerService(order.customerId, {
            triggeredBy: `webhook:${provider}:${opaqueFingerprint(providerEventId)}`,
            invoiceId: order.invoiceId,
            tenantId: orderTenantId,
            idempotencyKey: invoiceResult.reactivationDecision?.reactivationIdempotencyKey
              ?? rootActionIdempotencyKey(invoiceResult.canonicalPaymentId!, order.customerId),
            webhookFence: {
              ...webhookFence,
              canonicalPaymentId: invoiceResult.canonicalPaymentId,
            },
          });
          reactivationTriggered = !reactivation.alreadyActive;
          mikrotikActionId = reactivation.mikrotikAction?.id;
        }

        await this.closeOrThrow(eventId, tenantId, claimToken);
        logger.info('PaymentEngine: pago confirmado', {
          orderId: order.id, invoiceId: order.invoiceId, customerId: order.customerId, tenantId: orderTenantId,
        });
      } else if (provider === 'codi') {
        const reference = String(claimedPayload.reference ?? claimedPayload.referencia ?? '')
          .trim()
          .toUpperCase();
        if (!reference) {
          throw new ServiceUnavailableError(
            'El webhook CoDi no contiene una referencia resoluble.',
            'CODI_REFERENCE_UNRESOLVED',
          );
        }
        const billing = getBillingService();
        const matchingInvoices = (await billing.listInvoices(tenantId)).filter(
          (candidate) => `${candidate.id}-${candidate.clientId}`.trim().toUpperCase() === reference,
        );
        if (matchingInvoices.length !== 1) {
          throw new ServiceUnavailableError(
            matchingInvoices.length === 0
              ? 'La referencia CoDi no corresponde a una factura unica.'
              : 'La referencia CoDi coincide con multiples facturas.',
            matchingInvoices.length === 0
              ? 'CODI_REFERENCE_UNRESOLVED'
              : 'CODI_REFERENCE_AMBIGUOUS',
          );
        }
        const invoice = matchingInvoices[0];
        const invoiceTenantId = invoice.tenantId || 'tenant-default';
        const existingPayment = invoice.payments.find(
          (payment) => payment.provider === 'codi' && payment.transactionId === reference,
        );
        // `??` no salta el 0: una factura ya saldada por otro medio dejaba un
        // `pendingAmount` de 0 como importe del cobro y Billing respondía 400.
        // Un 400 le dice al proveedor que no reintente, así que el evento
        // quedaba sin procesar y el cobro se perdía en silencio. Sin importe
        // declarado sólo el cobro CoDi ya registrado o un saldo pendiente real
        // pueden resolverlo; cobrar el total facturado sería inventarlo. Esta
        // ruta falla cerrada y retryable, como el resto del resolver CoDi.
        const declaredAmount = claimedPayload.amount ?? claimedPayload.monto;
        const hasDeclaredAmount = declaredAmount !== undefined && declaredAmount !== null;
        const amount = Number(
          hasDeclaredAmount
            ? declaredAmount
            : (existingPayment?.amount ?? invoice.pendingAmount),
        );
        if (!hasDeclaredAmount && (!Number.isFinite(amount) || amount <= 0)) {
          throw new ServiceUnavailableError(
            'El webhook CoDi no declara importe y la factura no tiene saldo pendiente resoluble.',
            'CODI_AMOUNT_UNRESOLVED',
          );
        }
        const paymentResult = await this.applyWebhookPaymentOrThrow(
          { beforeMutation: () => this.renewOrThrow(eventId, tenantId, claimToken), eventId, claimToken },
          {
            invoiceId: invoice.id,
            tenantId: invoiceTenantId,
            amount,
            method: 'Transferencia',
            provider: 'codi',
            transactionId: reference,
          },
        );
        invoiceUpdated = true;

        let reactivationDecision: AutomaticReactivationDecision | undefined;
        if (paymentResult.canonicalPaymentId) {
          reactivationDecision = await evaluateAutomaticPaymentReactivation({
            tenantId: invoiceTenantId,
            customerId: invoice.clientId,
            canonicalPaymentId: paymentResult.canonicalPaymentId,
            invoiceId: invoice.id,
            origin: 'webhook',
          });
        }

        const shouldReactivate = Boolean(paymentResult.settlementWinner)
          && await this.shouldRunAutomaticReactivation(reactivationDecision);
        await this.renewOrThrow(eventId, tenantId, claimToken);
        await this.recordAutomaticReactivationDecisionOnce(reactivationDecision, shouldReactivate);
        if (shouldReactivate && reactivationDecision) {
          await this.renewOrThrow(eventId, tenantId, claimToken);
          await clearFinancialSuspensionBlocksForDecision(reactivationDecision, `webhook:codi:${opaqueFingerprint(providerEventId)}`);
          const reactivation = await this.reactivateCustomerService(invoice.clientId, {
            triggeredBy: `webhook:codi:${opaqueFingerprint(providerEventId)}`,
            invoiceId: invoice.id,
            tenantId: invoiceTenantId,
            idempotencyKey: reactivationDecision.reactivationIdempotencyKey,
            webhookFence: {
              beforeMutation: () => this.renewOrThrow(eventId, tenantId, claimToken),
              eventId,
              claimToken,
              canonicalPaymentId: paymentResult.canonicalPaymentId ?? undefined,
            },
          });
          reactivationTriggered = !reactivation.alreadyActive;
          mikrotikActionId = reactivation.mikrotikAction?.id;
        }
        await this.closeOrThrow(eventId, tenantId, claimToken);
        return {
          eventId,
          idempotent: false,
          invoiceUpdated,
          reactivationTriggered,
          mikrotikActionId,
          message: invoiceUpdated ? 'Pago CoDi aplicado a factura.' : 'Evento CoDi sin factura asociada.',
        };
      } else {
        // Webhook de proveedor sin order registrada — guardar y continuar
        await this.closeOrThrow(eventId, tenantId, claimToken);
        logger.warn('PaymentEngine: webhook sin payment_order asociada', {
          provider,
          orderFingerprint: providerOrderId ? opaqueFingerprint(providerOrderId) : undefined,
          tenantId,
        });
      }

      return {
        eventId, idempotent: false, invoiceUpdated, reactivationTriggered, mikrotikActionId,
        message: invoiceUpdated
          ? reactivationTriggered
            ? 'Pago confirmado, factura saldada y reactivación programada.'
            : 'Pago confirmado; la factura conserva saldo pendiente.'
          : 'Evento procesado (sin order asociada o factura ya pagada).',
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        // Conflicto determinista: queda abierto para intervención y no se
        // disfraza como pérdida de ownership ni se reintenta dentro del handler.
        logger.error('PaymentEngine: conflicto de idempotencia; requiere intervención', {
          eventId,
          provider,
          eventFingerprint: opaqueFingerprint(providerEventId),
          tenantId,
          scope: error.scope,
          idempotencyKeyFingerprint: error.fingerprint,
        });
        throw error;
      }
      if (!(error instanceof ClaimOwnershipLostError)) throw error;
      logger.warn('PaymentEngine: ownership del claim perdido; efectos posteriores abortados', {
        eventId, provider, eventFingerprint: opaqueFingerprint(providerEventId), tenantId,
      });
      return lostOwnershipResult();
    }
  }

  // ── Billing integration ───────────────────────────────────────────

  private async confirmPaymentOnInvoice(
    order: PaymentOrderRecord,
    tenantId?: string,
    webhookFence?: WebhookMutationFence,
  ): Promise<{
    updated: boolean;
    invoice: EnrichedInvoice | null;
    shouldReactivate: boolean;
    canonicalPaymentId?: string;
    reactivationDecision?: AutomaticReactivationDecision;
  }> {
    const billing = getBillingService();
    const effectiveTenantId = tenantId || order.tenantId || 'tenant-default';
    const invoice = await billing.findInvoiceById(order.invoiceId, effectiveTenantId);
    if (!invoice) {
      logger.warn('PaymentEngine: factura no encontrada para order', { invoiceId: order.invoiceId, tenantId: effectiveTenantId });
      return { updated: false, invoice: null, shouldReactivate: false };
    }

    const transactionId = order.providerOrderId ?? order.id;
    // Billing valida identidad e importe dentro de su operación atómica. Una
    // lectura previa nunca puede convertir una redelivery incompatible en éxito.
    const paymentResult = await this.applyWebhookPaymentOrThrow(webhookFence, {
      invoiceId: order.invoiceId,
      tenantId: effectiveTenantId,
      amount: order.amountCents / 100,
      method: order.provider,
      provider: order.provider,
      transactionId,
    });

    let reactivationDecision: AutomaticReactivationDecision | undefined;
    if (paymentResult.canonicalPaymentId) {
      reactivationDecision = await evaluateAutomaticPaymentReactivation({
        tenantId: effectiveTenantId,
        customerId: order.customerId,
        canonicalPaymentId: paymentResult.canonicalPaymentId,
        invoiceId: order.invoiceId,
        origin: 'webhook',
      });
    }

    const shouldReactivate = Boolean(paymentResult.settlementWinner)
      && await this.shouldRunAutomaticReactivation(reactivationDecision);
    await webhookFence?.beforeMutation();
    await this.recordAutomaticReactivationDecisionOnce(reactivationDecision, shouldReactivate);

    logger.info('PaymentEngine: cobro conciliado con Billing', {
      invoiceId: order.invoiceId,
      tenantId: effectiveTenantId,
      invoiceSettled: isInvoiceSettled(paymentResult.invoice),
      automaticReactivationOutcome: reactivationDecision?.outcome,
    });
    return {
      updated: true,
      invoice: paymentResult.invoice,
      shouldReactivate,
      canonicalPaymentId: paymentResult.canonicalPaymentId ?? undefined,
      reactivationDecision,
    };
  }

  /**
   * Aplica el pago del webhook con identidad durable y claim validado por el
   * propio ledger. Sin `webhookFence` (llamada manual) mantiene el contrato
   * histórico de `recordPayment`.
   */
  private async applyWebhookPaymentOrThrow(
    webhookFence: WebhookMutationFence | undefined,
    payment: { invoiceId: string; tenantId: string; amount: number; method: string; provider: string; transactionId: string },
  ): Promise<WebhookPaymentResult> {
    const billing = getBillingService();
    if (!webhookFence) {
      const invoice = await billing.recordPayment(payment.invoiceId, {
        amount: payment.amount,
        method: payment.method,
        transactionId: payment.transactionId,
      }, payment.tenantId);
      return {
        outcome: 'created',
        invoice,
        wasSettledBefore: false,
        isSettledAfter: isInvoiceSettled(invoice),
        settlementWinner: false,
        canonicalPaymentId: null,
      };
    }

    await webhookFence.beforeMutation();
    const result = await billing.applyWebhookPayment({
      ...payment,
      idempotencyKey: webhookPaymentIdempotencyKey(payment.provider, payment.transactionId),
      claim: { eventId: webhookFence.eventId, claimToken: webhookFence.claimToken },
    });
    // El ledger es la autoridad del claim: si dice que el owner cambió, esta
    // entrega se detiene aquí y el nuevo owner recupera el mismo pago por key.
    if (result.outcome === 'ownership_lost') throw new ClaimOwnershipLostError();
    return result;
  }

  // ── Reactivación lógica ───────────────────────────────────────────

  async reactivateCustomerService(
    customerId: string,
    context: ReactivationContext,
  ): Promise<ReactivationResult> {
    if (!customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');
    const tenantId = requireTenantId(context.tenantId, 'reactivateCustomerService');
    const triggeredBy = context?.triggeredBy ?? 'payment-engine';
    const webhookFence = context?.webhookFence;
    const requestedDryRun = !productionGates.paymentsRouterLive();
    const operationKey = context.idempotencyKey?.trim();
    if ((!requestedDryRun || webhookFence) && !operationKey) {
      throw new BadRequestError(
        'idempotencyKey es obligatorio para reactivaciones live y webhooks.',
        'REACTIVATION_IDEMPOTENCY_KEY_REQUIRED',
      );
    }
    const canonicalPaymentId = webhookFence?.canonicalPaymentId;
    if (webhookFence && !canonicalPaymentId) {
      throw new ServiceUnavailableError(
        'Billing no resolvió la identidad canónica de la reactivación.',
        'WEBHOOK_CANONICAL_PAYMENT_UNAVAILABLE',
      );
    }

    const dataProvider = buildPaymentDataProvider();
    const client = await dataProvider.getCustomer(customerId, tenantId);
    if (!client) throw new NotFoundError(`Cliente '${customerId}' no encontrado.`);

    // La identidad durable del webhook permite reusar la acción ya creada. La
    // lectura es intencionalmente exclusiva de esta ruta: una llamada manual
    // conserva la semántica histórica de "activo => no-op".
    const expectedWebhookKey = webhookFence
      ? rootActionIdempotencyKey(canonicalPaymentId!, customerId)
      : undefined;
    if (expectedWebhookKey && operationKey !== expectedWebhookKey) {
      throw new IdempotencyConflictError('reactivation_context', operationKey ?? '(vacía)');
    }
    const rootKey = operationKey;
    const existingAction = rootKey
      ? await this.repo.findActionByIdempotencyKey(tenantId, rootKey) ?? undefined
      : undefined;
    // La orden es la raíz de la saga. Debe resolverse antes del no-op por
    // cliente activo: puede existir aunque el write de la acción haya fallado.
    const existingOrder = rootKey
      ? await getSuspensionService().repo.findReactivationOrderByIdempotencyKey(tenantId, rootKey)
        ?? undefined
      : undefined;

    // Un cliente inicialmente activo no necesita reactivación. En webhook solo
    // se reanuda si ya existe alguna raíz durable de este mismo evento.
    if (client.status === 'active' && (!rootKey || (!existingAction && !existingOrder))) {
      logger.info('PaymentEngine: cliente ya activo, reactivación omitida', { customerId, tenantId });
      return { customerId, alreadyActive: true, mikrotikAction: null, message: 'Cliente ya activo.' };
    }

    // La acción conserva el progreso durable después de que la orden de red
    // exista. Así B distingue una reanudación de un cliente que ya era activo.
    const durablePreviousStatus = existingAction?.payload?.previousStatus;
    const prevStatus = typeof durablePreviousStatus === 'string'
      ? durablePreviousStatus
      : client.status === 'active' ? undefined : client.status;
    const routers = inventoryRoutersRepository.list();
    const tenantRouters = filterRoutersByTenant(routers, tenantId);
    // Una acción durable conserva su destino original. Para una acción nueva,
    // el router explícito del cliente manda; el fallback nunca sale del tenant.
    const durableRouterId = existingAction?.routerId ?? existingOrder?.routerId;
    const requestedRouterId = durableRouterId ?? client.routerId;
    const requestedRouter = requestedRouterId
      ? findRouterForTenant(routers, requestedRouterId, tenantId)
      : undefined;
    if (webhookFence && requestedRouterId && !requestedRouter) {
      throw new ServiceUnavailableError(
        'El router explícito del cliente no pertenece al tenant o no existe.',
        'TENANT_ROUTER_MISMATCH',
      );
    }
    const router = requestedRouter
      ?? tenantRouters.find((r) => r.encryptedPassword || r.hasCredentials)
      ?? tenantRouters[0];
    if (!router && webhookFence) {
      throw new ServiceUnavailableError(
        'No hay un router disponible para el tenant del cliente.',
        'TENANT_ROUTER_UNAVAILABLE',
      );
    }
    if (requestedDryRun === false && !router) {
      throw new BadRequestError(
        `No hay router para el tenant '${tenantId}'; reactivación live bloqueada.`,
        'TENANT_ROUTER_NOT_FOUND',
      );
    }
    if (requestedDryRun === false && router && !router.encryptedPassword && !router.hasCredentials) {
      throw new BadRequestError(
        `No hay router elegible para el tenant '${tenantId}'; reactivación live bloqueada.`,
        'TENANT_ROUTER_NOT_ELIGIBLE',
      );
    }
    if (rootKey && !router) {
      throw new ServiceUnavailableError(
        'No hay un router disponible para crear la orden durable.',
        'TENANT_ROUTER_UNAVAILABLE',
      );
    }

    // F3: esta fila es el primer write del flujo. Si el esquema aún no tiene
    // router_id/tenant_id/idempotency_key, el error ocurre sin estado parcial.
    if (rootKey) await webhookFence?.beforeMutation();
    const durableOrder = rootKey
      ? await createOrGetNetworkOrder({
          customerId,
          tenantId,
          routerId: router!.id,
          orderType: 'reactivation',
          source: 'payment-engine',
          reason: `Pago confirmado. Factura: ${context?.invoiceId ?? 'N/A'}`,
          actor: triggeredBy,
          idempotencyKey: rootKey,
        })
      : undefined;

    // Contrato histórico manual: Customers y timeline se completan ANTES de
    // persistir la acción. Si cualquiera falla, no queda una acción pending y
    // un retry vuelve a empezar sin duplicar acciones huérfanas.
    const manualProgress: WebhookReactivationProgress = {};
    if (!rootKey) {
      await dataProvider.reactivateCustomer(customerId, tenantId);
      manualProgress.customerReactivated = true;
      await getCustomersService().addTimelineEvent({
        clientId: customerId,
        eventType: 'status_change',
        summary: `Cambio de estado ${prevStatus} → active`,
        details: `Reactivación por pago confirmado. ${context?.invoiceId ? `Factura: ${context.invoiceId}.` : ''}${requestedDryRun ? ' Pendiente ejecución en router (dry_run).' : ' Orden de reactivación encolada.'}`,
        createdBy: triggeredBy,
      });
      manualProgress.timelineAdded = true;
    }
    let actionRec = existingAction;
    if (!actionRec) {
      const candidate: TenantOwned<MikrotikActionRecord> = {
        id: await this.repo.nextActionId(),
        tenantId,
        customerId,
        routerId: router?.id,
        actionType: 'reactivate',
        status: 'pending',
        dryRun: requestedDryRun,
        payload: {
          previousStatus: prevStatus,
          invoiceId: context?.invoiceId,
          pppoeUser: client.pppoeUser,
          reason: 'payment_confirmed',
        },
        triggeredBy,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (rootKey) {
        // La acción también es create-or-get: ambos owners reciben el mismo id
        // y por tanto la misma familia `actionId + step` aguas abajo.
        await webhookFence?.beforeMutation();
        const created = await this.repo.createActionIdempotent({
          ...candidate,
          paymentEventId: webhookFence?.eventId,
          webhookPaymentId: canonicalPaymentId,
          idempotencyKey: rootKey,
        });
        actionRec = created.action;
      } else {
        await this.repo.createAction(candidate);
        actionRec = candidate;
      }
    }

    // La acción conserva el modo del primer intento aunque cambien los gates
    // entre A y B. Sus checkpoints hacen reanudable cada paso independiente.
    const durableAction: MikrotikActionRecord = actionRec;
    const durableTriggeredBy = durableAction.triggeredBy ?? triggeredBy;
    const dryRun = durableAction.dryRun;
    const routerLive = !dryRun;
    let progress = webhookFence
      ? readWebhookReactivationProgress(durableAction)
      : manualProgress;
    const effectKey = (step: WebhookReactivationStep): string =>
      stepIdempotencyKey(durableAction.id, step);

    /**
     * Confirma un paso terminado. El write es una operación set-only en la
     * base, condicionada al claim vigente: el owner vencido no puede escribir
     * (y por tanto no puede borrar el progreso del nuevo), y el nuevo owner
     * puede confirmar un efecto que creó el anterior porque lo recupera por
     * la misma idempotency key.
     */
    const checkpoint = async (step: WebhookReactivationStep): Promise<void> => {
      if (!webhookFence || progress[step]) return;
      const outcome = await this.repo.checkpointReactivationStep({
        tenantId,
        eventId: webhookFence.eventId,
        actionId: durableAction.id,
        claimToken: webhookFence.claimToken,
        step,
      });
      if (outcome === 'ownership_lost') throw new ClaimOwnershipLostError();
      progress = { ...progress, [step]: true };
      durableAction.result = {
        ...(durableAction.result ?? {}),
        [WEBHOOK_REACTIVATION_PROGRESS_KEY]: progress,
      };
    };

    if (!progress.customerReactivated) {
      if (client.status !== 'active') {
        await webhookFence?.beforeMutation();
        await dataProvider.reactivateCustomer(customerId, tenantId);
      }
      await checkpoint('customerReactivated');
    }

    if (!progress.timelineAdded) {
      await webhookFence?.beforeMutation();
      await getCustomersService().addTimelineEvent({
        clientId: customerId,
        eventType: 'status_change',
        summary: prevStatus
          ? `Cambio de estado ${prevStatus} → active`
          : 'Reactivación reanudada para cliente activo',
        details: `Reactivación por pago confirmado. ${context?.invoiceId ? `Factura: ${context.invoiceId}.` : ''}${dryRun ? ' Pendiente ejecución en router (dry_run).' : ' Orden de reactivación encolada.'}`,
        createdBy: durableTriggeredBy,
      }, rootKey ? { tenantId, idempotencyKey: effectKey('timelineAdded') } : undefined);
      await checkpoint('timelineAdded');
    }

    if (routerLive && durableOrder && !progress.networkDispatched) {
      await webhookFence?.beforeMutation();
      await processNetworkOrder(durableOrder, durableTriggeredBy);
      await checkpoint('networkDispatched');
    }

    if (!progress.suspensionEventRecorded) {
      await webhookFence?.beforeMutation();
      await getSuspensionService().repo.recordEvent({
        customerId,
        eventType: 'reactivation_order_created',
        reason: `Pago confirmado vía Payment Engine. Factura: ${context?.invoiceId ?? 'N/A'}.`,
        automatic: true,
        actorId: durableTriggeredBy,
        metadata: { dryRun, routerLive },
        tenantId: rootKey ? tenantId : undefined,
        idempotencyKey: rootKey ? effectKey('suspensionEventRecorded') : undefined,
      });
      await checkpoint('suspensionEventRecorded');
    }

    if (!progress.alertCreated) {
      await webhookFence?.beforeMutation();
      const message = `Servicio reactivado por pago confirmado.${dryRun ? ' Acción MikroTik pendiente (dry_run).' : ' Orden de reactivación procesada.'}`;
      if (rootKey) {
        // La alerta pasa a existir también en modo Supabase: antes sólo se
        // creaba con Customers en store, así que no había efecto que revisar.
        await getAlertSink().createAlertIdempotent({
          tenantId,
          idempotencyKey: effectKey('alertCreated'),
          sourceType: 'client',
          severity: 'info',
          source: client.name,
          message,
        });
      } else if (!isDomainOnDb('customers')) {
        store.createAlert('client', 'info', client.name, message);
      }
      await checkpoint('alertCreated');
    }

    logger.info('PaymentEngine: reactivación completada', {
      customerId, actionId: durableAction.id, dryRun,
    });

    return {
      customerId,
      alreadyActive: false,
      mikrotikAction: mikrotikActionToView(durableAction),
      message: dryRun
        ? 'Servicio reactivado lógicamente. Acción MikroTik en cola (dry_run=true).'
        : 'Servicio reactivado. Orden de reactivación en cola para el worker.',
    };
  }

  // ── Mikrotik actions ──────────────────────────────────────────────

  async listActions(filter: { tenantId: string; customerId?: string }) {
    const actions = await this.repo.listActions({
      ...filter,
      tenantId: requireTenantId(filter.tenantId, 'listActions'),
    });
    return actions.map(mikrotikActionToView);
  }

  async getAction(id: string, tenantId: string): Promise<MikrotikActionView | null> {
    const action = await this.repo.findActionById(id, requireTenantId(tenantId, 'getAction'));
    return action ? mikrotikActionToView(action) : null;
  }

  // ── Helpers privados ──────────────────────────────────────────────

  private isApprovedEvent(
    provider: PaymentProvider,
    eventType: string,
    payload: Record<string, unknown>,
  ): boolean {
    const t = eventType.toLowerCase();
    if (provider === 'openpay') {
      const transactionStatus = String(
        (payload.transaction as { status?: unknown } | undefined)?.status ?? '',
      ).toLowerCase();
      // OpenPay publica el cargo completado como charge.succeeded y coloca el
      // estado dentro de transaction. No inferir aprobación de otros
      // `*.succeeded` (payout/transfer/fee son eventos financieros distintos).
      return t === 'charge.succeeded' && transactionStatus === 'completed';
    }
    if (t.includes('approved') || t.includes('completed') || t.includes('paid') || t.includes('success')) return true;
    const status = (payload.status as string ?? '').toLowerCase();
    return status === 'approved' || status === 'completed' || status === 'paid';
  }

  private extractProviderOrderId(provider: PaymentProvider, payload: Record<string, unknown>): string | null {
    if (provider === 'mercado_pago') {
      return (payload.external_reference as string) ?? (payload.data as { id?: string } | undefined)?.id ?? null;
    }
    if (provider === 'openpay') {
      return (payload.order_id as string) ?? (payload.transaction as { order_id?: string } | undefined)?.order_id ?? null;
    }
    if (provider === 'codi') {
      return (payload.reference as string) ?? (payload.referencia as string) ?? null;
    }
    return (payload.order_id as string) ?? (payload.orderId as string) ?? null;
  }
}

// ── Factoría singleton ────────────────────────────────────────────────

let singleton: PaymentService | null = null;

const buildService = (): PaymentService => {
  if (isDomainOnDb('payments')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error('USE_DB_PAYMENTS=true pero Supabase no está configurado.');
    }
    logger.info('PaymentEngine: persistencia = Supabase (USE_DB_PAYMENTS=true)');
    return new PaymentService(new SupabasePaymentRepository(supabaseAdmin));
  }
  logger.info('PaymentEngine: persistencia = store en memoria (USE_DB_PAYMENTS=false)');
  return new PaymentService(new StorePaymentRepository());
};

export const getPaymentService = (): PaymentService => {
  if (!singleton) singleton = buildService();
  return singleton;
};

export const resetPaymentService = (): void => { singleton = null; };
