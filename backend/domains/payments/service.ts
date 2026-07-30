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
import { BadRequestError, NotFoundError } from '../../common/errors';
import { productionGates } from '../../config/production-gates';
import { dispatchNetworkOrder } from '../../bridges/network-order-dispatch';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getBillingService } from '../billing/service';
import { getCustomersService } from '../customers/service';
import { getSuspensionService } from '../suspension/service';
import { inventoryRoutersRepository } from '../inventory/routers/repository';
import { store } from '../../state/store';
import { buildPaymentDataProvider } from './data-provider';
import { resolveProvider } from './providers/index';
import {
  StorePaymentRepository,
  SupabasePaymentRepository,
  PaymentRepository,
} from './repository';
import {
  CreatePaymentOrderInput,
  MikrotikActionView,
  PaymentEventRecord,
  PaymentOrderRecord,
  PaymentProvider,
  ProcessWebhookInput,
  ReactivationContext,
  ReactivationResult,
  WebhookMutationFence,
  WebhookProcessResult,
} from './types';
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

// ── Servicio ──────────────────────────────────────────────────────────

export class PaymentService {
  constructor(private readonly repo: PaymentRepository) {}

  /**
   * Barrera de fencing compartida por todos los efectos del webhook. Renueva
   * el lease y aborta inmediatamente si otro procesador ya rotó el epoch.
   */
  private async renewOrThrow(eventId: string, claimToken: string | undefined): Promise<void> {
    if (!claimToken || !await this.repo.renewEventClaim(eventId, claimToken)) {
      throw new ClaimOwnershipLostError();
    }
  }

  /** El cierre sigue siendo un CAS condicionado por el mismo epoch. */
  private async closeOrThrow(eventId: string, claimToken: string | undefined): Promise<void> {
    if (!claimToken || !await this.repo.markEventProcessed(eventId, claimToken)) {
      throw new ClaimOwnershipLostError();
    }
  }

  // ── Payment Orders ────────────────────────────────────────────────

  async listOrders(filter?: { customerId?: string; invoiceId?: string; tenantId?: string }) {
    const orders = await this.repo.listOrders(filter);
    return orders.map(paymentOrderToView);
  }

  async getOrder(id: string, tenantId?: string) {
    const order = await this.repo.findOrderById(id, tenantId);
    return order ? paymentOrderToView(order) : null;
  }

  async createOrder(input: CreatePaymentOrderInput) {
    if (!input.customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');
    if (!input.invoiceId?.trim()) throw new BadRequestError('invoiceId es obligatorio.');
    const provider = assertValidProvider(input.provider);
    const tenantId = input.tenantId || 'tenant-default';

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

    const rec: PaymentOrderRecord = {
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
    const { provider, providerEventId, eventType, payload, tenantId } = input;

    // Idempotencia POR TENANT mediante CLAIM atómico: dos merchants pueden
    // reutilizar el mismo provider_event_id (solo colisiona dentro del mismo
    // WISP), y dos entregas simultáneas del mismo evento no pueden procesarse
    // las dos — solo la que se lleva el claim continúa.
    const eventRec: PaymentEventRecord = {
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
        provider, providerEventId, tenantId, reason: claim.outcome,
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
      // Fencing temprano: un procesador que despertó después de que otro
      // reclamara el lease no llega siquiera a las lecturas que preceden efectos.
      await this.renewOrThrow(eventId, claimToken);

      // Solo eventos de pago aprobado disparan el flujo completo
      const isApproved = this.isApprovedEvent(provider, claimedEventType, claimedPayload);
      if (!isApproved) {
        await this.closeOrThrow(eventId, claimToken);
        logger.info('PaymentEngine: webhook recibido (no aprobado, no acción)', {
          provider, eventType: claimedEventType, tenantId,
        });
        return {
          eventId, idempotent: false, invoiceUpdated: false,
          reactivationTriggered: false, message: 'Evento recibido, sin acción (no es aprobación de pago).',
        };
      }

      // Buscar payment_order por providerOrderId DENTRO del WISP del evento: un
      // provider_order_id de otro merchant nunca puede completar esta order.
      const providerOrderId = this.extractProviderOrderId(provider, claimedPayload);
      const order = providerOrderId
        ? await this.repo.findOrderByProviderOrderId(provider, providerOrderId, tenantId)
        : null;

      let invoiceUpdated = false;
      let reactivationTriggered = false;
      let mikrotikActionId: string | undefined;

      if (order) {
        const orderTenantId = order.tenantId || 'tenant-default';
        // Cada llamada mutante tiene su propia barrera: perder ownership dentro
        // de un efecto impide alcanzar el siguiente.
        await this.renewOrThrow(eventId, claimToken);
        await this.repo.updateOrderStatus(order.id, 'completed', undefined, orderTenantId);

        await this.renewOrThrow(eventId, claimToken);
        const webhookFence: WebhookMutationFence = {
          beforeMutation: () => this.renewOrThrow(eventId, claimToken),
        };
        const invoiceResult = await this.confirmPaymentOnInvoice(order, orderTenantId, webhookFence);
        invoiceUpdated = invoiceResult.updated;

        await this.renewOrThrow(eventId, claimToken);
        const reactivation = await this.reactivateCustomerService(order.customerId, {
          triggeredBy: `webhook:${provider}:${providerEventId}`,
          invoiceId: order.invoiceId,
          tenantId: orderTenantId,
          webhookFence,
        });
        reactivationTriggered = !reactivation.alreadyActive;
        mikrotikActionId = reactivation.mikrotikAction?.id;

        await this.closeOrThrow(eventId, claimToken);
        logger.info('PaymentEngine: pago confirmado', {
          orderId: order.id, invoiceId: order.invoiceId, customerId: order.customerId, tenantId: orderTenantId,
        });
      } else if (provider === 'codi') {
        const reference = String(claimedPayload.reference ?? claimedPayload.referencia ?? '').toUpperCase();
        if (reference) {
          const invoiceId = reference.split('-')[0];
          const orders = await this.repo.listOrders({ invoiceId, tenantId });
          const order = orders.find((o) => o.provider === 'codi') ?? orders[0];
          if (order) {
            const orderTenantId = order.tenantId || 'tenant-default';
            await this.renewOrThrow(eventId, claimToken);
            await this.repo.updateOrderStatus(order.id, 'completed', undefined, orderTenantId);
            await this.renewOrThrow(eventId, claimToken);
            const webhookFence: WebhookMutationFence = {
              beforeMutation: () => this.renewOrThrow(eventId, claimToken),
            };
            const invoiceResult = await this.confirmPaymentOnInvoice(order, orderTenantId, webhookFence);
            invoiceUpdated = invoiceResult.updated;
            await this.renewOrThrow(eventId, claimToken);
            const reactivation = await this.reactivateCustomerService(order.customerId, {
              triggeredBy: `webhook:codi:${providerEventId}`,
              invoiceId: order.invoiceId,
              tenantId: orderTenantId,
              webhookFence,
            });
            reactivationTriggered = !reactivation.alreadyActive;
            mikrotikActionId = reactivation.mikrotikAction?.id;
            await this.closeOrThrow(eventId, claimToken);
            return {
              eventId,
              idempotent: false,
              invoiceUpdated,
              reactivationTriggered,
              mikrotikActionId,
              message: 'Pago CoDi confirmado y cliente reactivado.',
            };
          }
          // Sin order previa: intentar factura directa por referencia (del WISP).
          const billing = getBillingService();
          const invoice = await billing.findInvoiceById(invoiceId, tenantId);
          if (invoice) {
            const invoiceTenantId = invoice.tenantId || 'tenant-default';
            const paymentAlreadyAppliedByEvent = invoice.payments.some(
              (payment) => payment.transactionId === providerEventId,
            );
            let shouldReactivate = paymentAlreadyAppliedByEvent;

            if (invoice.status !== 'paid' && !paymentAlreadyAppliedByEvent) {
              await this.renewOrThrow(eventId, claimToken);
              const amount = Number(
                claimedPayload.amount ?? claimedPayload.monto ?? invoice.pendingAmount ?? invoice.amount,
              );
              await billing.recordPayment(invoice.id, {
                amount,
                method: 'Transferencia',
                transactionId: providerEventId,
              }, invoiceTenantId);
              shouldReactivate = true;
            }

            if (shouldReactivate) {
              invoiceUpdated = true;
              await this.renewOrThrow(eventId, claimToken);
              const reactivation = await this.reactivateCustomerService(invoice.clientId, {
                triggeredBy: `webhook:codi:${providerEventId}`,
                invoiceId: invoice.id,
                tenantId: invoiceTenantId,
                webhookFence: {
                  beforeMutation: () => this.renewOrThrow(eventId, claimToken),
                },
              });
              reactivationTriggered = !reactivation.alreadyActive;
              mikrotikActionId = reactivation.mikrotikAction?.id;
            }
          }
        }
        await this.closeOrThrow(eventId, claimToken);
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
        await this.closeOrThrow(eventId, claimToken);
        logger.warn('PaymentEngine: webhook sin payment_order asociada', { provider, providerOrderId, tenantId });
      }

      return {
        eventId, idempotent: false, invoiceUpdated, reactivationTriggered, mikrotikActionId,
        message: invoiceUpdated
          ? 'Pago confirmado, factura actualizada y reactivación programada.'
          : 'Evento procesado (sin order asociada o factura ya pagada).',
      };
    } catch (error) {
      if (!(error instanceof ClaimOwnershipLostError)) throw error;
      logger.warn('PaymentEngine: ownership del claim perdido; efectos posteriores abortados', {
        eventId, provider, providerEventId, tenantId,
      });
      return lostOwnershipResult();
    }
  }

  // ── Billing integration ───────────────────────────────────────────

  private async confirmPaymentOnInvoice(
    order: PaymentOrderRecord,
    tenantId?: string,
    webhookFence?: WebhookMutationFence,
  ): Promise<{ updated: boolean }> {
    const billing = getBillingService();
    const effectiveTenantId = tenantId || order.tenantId || 'tenant-default';
    const invoice = await billing.findInvoiceById(order.invoiceId, effectiveTenantId);
    if (!invoice) {
      logger.warn('PaymentEngine: factura no encontrada para order', { invoiceId: order.invoiceId, tenantId: effectiveTenantId });
      return { updated: false };
    }

    const transactionId = order.providerOrderId ?? order.id;
    if (invoice.payments.some((payment) => payment.transactionId === transactionId)) {
      logger.info('PaymentEngine: pago ya aplicado por esta transacción (idempotente)', {
        invoiceId: order.invoiceId,
        transactionId,
      });
      return { updated: true };
    }

    // Idempotencia: si ya está pagada no duplicar
    if (invoice.status === 'paid' || invoice.pendingAmount <= 0) {
      logger.info('PaymentEngine: factura ya estaba pagada (idempotente)', { invoiceId: order.invoiceId });
      return { updated: false };
    }

    await webhookFence?.beforeMutation();
    await billing.recordPayment(order.invoiceId, {
      amount: order.amountCents / 100,
      method: order.provider,
      transactionId,
    }, effectiveTenantId);

    logger.info('PaymentEngine: factura marcada pagada', { invoiceId: order.invoiceId, tenantId: effectiveTenantId });
    return { updated: true };
  }

  // ── Reactivación lógica ───────────────────────────────────────────

  async reactivateCustomerService(
    customerId: string,
    context?: ReactivationContext,
  ): Promise<ReactivationResult> {
    if (!customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');
    const tenantId = context?.tenantId || 'tenant-default';
    const triggeredBy = context?.triggeredBy ?? 'payment-engine';
    const webhookFence = context?.webhookFence;

    const dataProvider = buildPaymentDataProvider();
    const client = await dataProvider.getCustomer(customerId, tenantId);
    if (!client) throw new NotFoundError(`Cliente '${customerId}' no encontrado.`);

    // La identidad durable del webhook permite reusar la acción ya creada. La
    // lectura es intencionalmente exclusiva de esta ruta: una llamada manual
    // conserva la semántica histórica de "activo => no-op".
    const existingAction = webhookFence
      ? (await this.repo.listActions({ customerId, tenantId })).find(
        (action) => action.actionType === 'reactivate' && action.triggeredBy === triggeredBy,
      )
      : undefined;

    // Un cliente inicialmente activo no necesita reactivación. En webhook solo
    // se reanuda si ya existe la acción durable de este mismo evento.
    if (client.status === 'active' && (!webhookFence || !existingAction)) {
      logger.info('PaymentEngine: cliente ya activo, reactivación omitida', { customerId, tenantId });
      return { customerId, alreadyActive: true, mikrotikAction: null, message: 'Cliente ya activo.' };
    }

    const routerLive = productionGates.paymentsRouterLive();
    const dryRun = !routerLive;

    // La acción es el marcador durable de intención y se crea antes del cambio
    // lógico. Así B distingue una reanudación de un cliente que ya era activo.
    const durablePreviousStatus = existingAction?.payload?.previousStatus;
    const prevStatus = typeof durablePreviousStatus === 'string'
      ? durablePreviousStatus
      : client.status === 'active' ? undefined : client.status;
    const routers = inventoryRoutersRepository.list();
    const router = routers.find((r) => r.encryptedPassword || r.hasCredentials) ?? routers[0];
    let actionRec = existingAction;
    if (!actionRec) {
      const actionId = await this.repo.nextActionId();
      actionRec = {
        id: actionId,
        tenantId,
        customerId,
        routerId: router?.id,
        actionType: 'reactivate',
        status: 'pending',
        dryRun,
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
      await webhookFence?.beforeMutation();
      await this.repo.createAction(actionRec);
    }

    if (client.status !== 'active') {
      await webhookFence?.beforeMutation();
      await dataProvider.reactivateCustomer(customerId, tenantId);
    }

    await webhookFence?.beforeMutation();
    await getCustomersService().addTimelineEvent({
      clientId: customerId,
      eventType: 'status_change',
      summary: prevStatus
        ? `Cambio de estado ${prevStatus} → active`
        : 'Reactivación reanudada para cliente activo',
      details: `Reactivación por pago confirmado. ${context?.invoiceId ? `Factura: ${context.invoiceId}.` : ''}${dryRun ? ' Pendiente ejecución en router (dry_run).' : ' Orden de reactivación encolada.'}`,
      createdBy: triggeredBy,
    });

    if (routerLive) {
      await webhookFence?.beforeMutation();
      await dispatchNetworkOrder({
        customerId,
        orderType: 'reactivation',
        source: 'payment-engine',
        reason: `Pago confirmado. Factura: ${context?.invoiceId ?? 'N/A'}`,
        actor: triggeredBy,
      });
    }

    await webhookFence?.beforeMutation();
    await getSuspensionService().repo.recordEvent({
      customerId,
      eventType: 'reactivation_order_created',
      reason: `Pago confirmado vía Payment Engine. Factura: ${context?.invoiceId ?? 'N/A'}.`,
      automatic: true,
      actorId: triggeredBy,
      metadata: { dryRun, routerLive },
    });

    if (!isDomainOnDb('customers')) {
      await webhookFence?.beforeMutation();
      store.createAlert(
        'client',
        'info',
        client.name,
        `Servicio reactivado por pago confirmado.${dryRun ? ' Acción MikroTik pendiente (dry_run).' : ' Orden de reactivación procesada.'}`,
      );
    }

    logger.info('PaymentEngine: reactivación completada', {
      customerId, actionId: actionRec.id, dryRun,
    });

    return {
      customerId,
      alreadyActive: false,
      mikrotikAction: mikrotikActionToView(actionRec),
      message: dryRun
        ? 'Servicio reactivado lógicamente. Acción MikroTik en cola (dry_run=true).'
        : 'Servicio reactivado. Orden de reactivación en cola para el worker.',
    };
  }

  // ── Mikrotik actions ──────────────────────────────────────────────

  async listActions(filter?: { customerId?: string; tenantId?: string }) {
    const actions = await this.repo.listActions(filter);
    return actions.map(mikrotikActionToView);
  }

  async getAction(id: string, tenantId?: string): Promise<MikrotikActionView | null> {
    const all = await this.repo.listActions({ tenantId });
    const action = all.find((a) => a.id === id);
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
