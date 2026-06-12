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
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getBillingService } from '../billing/service';
import { store } from '../../state/store';
import { getProvider } from './providers/index';
import {
  StorePaymentRepository,
  SupabasePaymentRepository,
  PaymentRepository,
} from './repository';
import {
  CreatePaymentOrderInput,
  MikrotikActionRecord,
  MikrotikActionView,
  PaymentEventRecord,
  PaymentOrderRecord,
  PaymentProvider,
  ProcessWebhookInput,
  ReactivationResult,
  WebhookProcessResult,
} from './types';
import {
  mikrotikActionToView,
  paymentOrderToView,
} from './mappers';

const nowIso = () => new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────────────────

const VALID_PROVIDERS: PaymentProvider[] = ['manual', 'mercado_pago', 'openpay', 'spei'];

const assertValidProvider = (p: unknown): PaymentProvider => {
  if (!VALID_PROVIDERS.includes(p as PaymentProvider)) {
    throw new BadRequestError(`Proveedor de pago inválido: ${p}. Válidos: ${VALID_PROVIDERS.join(', ')}`);
  }
  return p as PaymentProvider;
};

// ── Servicio ──────────────────────────────────────────────────────────

export class PaymentService {
  constructor(private readonly repo: PaymentRepository) {}

  // ── Payment Orders ────────────────────────────────────────────────

  async listOrders(filter?: { customerId?: string; invoiceId?: string }) {
    const orders = await this.repo.listOrders(filter);
    return orders.map(paymentOrderToView);
  }

  async getOrder(id: string) {
    const order = await this.repo.findOrderById(id);
    return order ? paymentOrderToView(order) : null;
  }

  async createOrder(input: CreatePaymentOrderInput) {
    if (!input.customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');
    if (!input.invoiceId?.trim()) throw new BadRequestError('invoiceId es obligatorio.');
    const provider = assertValidProvider(input.provider);

    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestError('amountCents debe ser un entero positivo (centavos).');
    }

    const providerImpl = getProvider(provider);

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
    logger.info('PaymentEngine: order creada', { orderId: id, provider, invoiceId: input.invoiceId });
    return paymentOrderToView(rec);
  }

  // ── Webhook processing ────────────────────────────────────────────

  async processWebhook(input: ProcessWebhookInput): Promise<WebhookProcessResult> {
    const { provider, providerEventId, eventType, payload } = input;

    // Idempotencia: si ya existe el evento, responder OK sin duplicar
    const existing = await this.repo.findEventByProviderId(provider, providerEventId);
    if (existing) {
      logger.info('PaymentEngine: webhook ya procesado (idempotente)', { provider, providerEventId });
      return {
        eventId: existing.id,
        idempotent: true,
        invoiceUpdated: false,
        reactivationTriggered: false,
        message: 'Evento ya procesado anteriormente.',
      };
    }

    // Guardar el evento
    const eventId = await this.repo.nextEventId();
    const eventRec: PaymentEventRecord = {
      id: eventId,
      provider,
      providerEventId,
      eventType,
      processed: false,
      payload,
      receivedAt: nowIso(),
    };
    await this.repo.createEvent(eventRec);

    // Solo eventos de pago aprobado disparan el flujo completo
    const isApproved = this.isApprovedEvent(eventType, payload);
    if (!isApproved) {
      await this.repo.markEventProcessed(eventId);
      logger.info('PaymentEngine: webhook recibido (no aprobado, no acción)', { provider, eventType });
      return {
        eventId, idempotent: false, invoiceUpdated: false,
        reactivationTriggered: false, message: 'Evento recibido, sin acción (no es aprobación de pago).',
      };
    }

    // Buscar payment_order por providerOrderId
    const providerOrderId = this.extractProviderOrderId(provider, payload);
    let order = providerOrderId
      ? await this.repo.findOrderByProviderOrderId(provider, providerOrderId)
      : null;

    let invoiceUpdated = false;
    let reactivationTriggered = false;
    let mikrotikActionId: string | undefined;

    if (order) {
      // Marcar order como completada
      await this.repo.updateOrderStatus(order.id, 'completed');

      // Integrar con Billing (idempotente: si la factura ya está paid, no duplica)
      const invoiceResult = await this.confirmPaymentOnInvoice(order);
      invoiceUpdated = invoiceResult.updated;

      // Reactivación lógica del cliente
      const reactivation = await this.reactivateCustomerService(order.customerId, {
        triggeredBy: `webhook:${provider}:${providerEventId}`,
        invoiceId: order.invoiceId,
      });
      reactivationTriggered = !reactivation.alreadyActive;
      mikrotikActionId = reactivation.mikrotikAction?.id;

      // Vincular evento a la order
      await this.repo.markEventProcessed(eventId);
      logger.info('PaymentEngine: pago confirmado', {
        orderId: order.id, invoiceId: order.invoiceId, customerId: order.customerId,
      });
    } else {
      // Webhook de proveedor sin order registrada — guardar y continuar
      await this.repo.markEventProcessed(eventId);
      logger.warn('PaymentEngine: webhook sin payment_order asociada', { provider, providerOrderId });
    }

    return {
      eventId, idempotent: false, invoiceUpdated, reactivationTriggered, mikrotikActionId,
      message: invoiceUpdated
        ? 'Pago confirmado, factura actualizada y reactivación programada.'
        : 'Evento procesado (sin order asociada o factura ya pagada).',
    };
  }

  // ── Billing integration ───────────────────────────────────────────

  private async confirmPaymentOnInvoice(order: PaymentOrderRecord): Promise<{ updated: boolean }> {
    const billing = getBillingService();
    const invoice = await billing.findInvoiceById(order.invoiceId);
    if (!invoice) {
      logger.warn('PaymentEngine: factura no encontrada para order', { invoiceId: order.invoiceId });
      return { updated: false };
    }

    // Idempotencia: si ya está pagada no duplicar
    if (invoice.status === 'paid' || invoice.pendingAmount <= 0) {
      logger.info('PaymentEngine: factura ya estaba pagada (idempotente)', { invoiceId: order.invoiceId });
      return { updated: false };
    }

    await billing.recordPayment(order.invoiceId, {
      amount: order.amountCents / 100,
      method: order.provider,
      transactionId: order.providerOrderId ?? order.id,
    });

    logger.info('PaymentEngine: factura marcada pagada', { invoiceId: order.invoiceId });
    return { updated: true };
  }

  // ── Reactivación lógica ───────────────────────────────────────────

  async reactivateCustomerService(
    customerId: string,
    context?: { triggeredBy?: string; invoiceId?: string },
  ): Promise<ReactivationResult> {
    if (!customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');

    const client = store.CLIENTS.find((c) => c.id === customerId);
    if (!client) throw new NotFoundError(`Cliente '${customerId}' no encontrado.`);

    // Idempotente: si ya está activo, no crear acción redundante
    if (client.status === 'active') {
      logger.info('PaymentEngine: cliente ya activo, reactivación omitida', { customerId });
      return { customerId, alreadyActive: true, mikrotikAction: null, message: 'Cliente ya activo.' };
    }

    // Cambio de estado lógico (sin tocar MikroTik real)
    const prevStatus = client.status;
    client.status = 'active';

    // Timeline del cliente
    store.addClientTimelineEvent({
      clientId: customerId,
      eventType: 'status_change',
      summary: `Cambio de estado ${prevStatus} → active`,
      details: `Reactivación lógica por pago confirmado. ${context?.invoiceId ? `Factura: ${context.invoiceId}.` : ''} Pendiente ejecución en router (dry_run).`,
      createdBy: context?.triggeredBy ?? 'payment-engine',
    });

    // Crear mikrotik_action dry_run=true — NO ejecuta en router real
    const actionId = await this.repo.nextActionId();
    const router = store.MIKROTIK_ROUTERS.find((r) => r.vpnIp);
    const actionRec: MikrotikActionRecord = {
      id: actionId,
      customerId,
      routerId: router?.id,
      actionType: 'reactivate',
      status: 'pending',
      dryRun: true,
      payload: {
        previousStatus: prevStatus,
        invoiceId: context?.invoiceId,
        pppoeUser: client.pppoeUser,
        reason: 'payment_confirmed',
      },
      triggeredBy: context?.triggeredBy ?? 'payment-engine',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.repo.createAction(actionRec);

    // Log suspension
    store.logSuspensionAction({
      clientId: customerId,
      clientName: client.name,
      action: 'reactivate',
      reason: `Pago confirmado vía Payment Engine. Factura: ${context?.invoiceId ?? 'N/A'}.`,
      source: 'automation',
      actorId: context?.triggeredBy ?? 'payment-engine',
    });

    // Alerta NOC
    store.createAlert(
      'client',
      'info',
      client.name,
      `Servicio reactivado lógicamente por pago confirmado. Acción MikroTik pendiente (dry_run).`,
    );

    logger.info('PaymentEngine: reactivación lógica completada', {
      customerId, actionId, dryRun: true,
    });

    return {
      customerId,
      alreadyActive: false,
      mikrotikAction: mikrotikActionToView(actionRec),
      message: 'Servicio reactivado lógicamente. Acción MikroTik en cola (dry_run=true).',
    };
  }

  // ── Mikrotik actions ──────────────────────────────────────────────

  async listActions(filter?: { customerId?: string }) {
    const actions = await this.repo.listActions(filter);
    return actions.map(mikrotikActionToView);
  }

  async getAction(id: string): Promise<MikrotikActionView | null> {
    const all = await this.repo.listActions();
    const action = all.find((a) => a.id === id);
    return action ? mikrotikActionToView(action) : null;
  }

  // ── Helpers privados ──────────────────────────────────────────────

  private isApprovedEvent(eventType: string, payload: Record<string, unknown>): boolean {
    const t = eventType.toLowerCase();
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
