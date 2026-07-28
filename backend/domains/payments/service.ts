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

import { nowIso } from '../../common/time';

// ── Helpers ───────────────────────────────────────────────────────────

const VALID_PROVIDERS: PaymentProvider[] = ['manual', 'mercado_pago', 'openpay', 'spei', 'codi'];

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
    const { provider, providerEventId, eventType, payload } = input;
    // WISP dueño del evento: acota idempotencia y búsqueda de order. Sin él,
    // el evento pertenece al WISP por defecto (single-WISP / legacy).
    const tenantId = input.tenantId || 'tenant-default';

    // Idempotencia POR TENANT: dos merchants pueden reutilizar el mismo
    // provider_event_id; solo colisiona dentro del mismo WISP.
    const existing = await this.repo.findEventByProviderId(provider, providerEventId, tenantId);
    if (existing) {
      logger.info('PaymentEngine: webhook ya procesado (idempotente)', { provider, providerEventId, tenantId });
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
      tenantId,
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
      logger.info('PaymentEngine: webhook recibido (no aprobado, no acción)', { provider, eventType, tenantId });
      return {
        eventId, idempotent: false, invoiceUpdated: false,
        reactivationTriggered: false, message: 'Evento recibido, sin acción (no es aprobación de pago).',
      };
    }

    // Buscar payment_order por providerOrderId DENTRO del WISP del evento: un
    // provider_order_id de otro merchant nunca puede completar esta order.
    const providerOrderId = this.extractProviderOrderId(provider, payload);
    const order = providerOrderId
      ? await this.repo.findOrderByProviderOrderId(provider, providerOrderId, tenantId)
      : null;

    let invoiceUpdated = false;
    let reactivationTriggered = false;
    let mikrotikActionId: string | undefined;

    if (order) {
      const orderTenantId = order.tenantId || 'tenant-default';
      // Marcar order como completada
      await this.repo.updateOrderStatus(order.id, 'completed', undefined, orderTenantId);

      // Integrar con Billing (idempotente: si la factura ya está paid, no duplica)
      const invoiceResult = await this.confirmPaymentOnInvoice(order, orderTenantId);
      invoiceUpdated = invoiceResult.updated;

      // Reactivación lógica del cliente (tenant de la order)
      const reactivation = await this.reactivateCustomerService(order.customerId, {
        triggeredBy: `webhook:${provider}:${providerEventId}`,
        invoiceId: order.invoiceId,
        tenantId: orderTenantId,
      });
      reactivationTriggered = !reactivation.alreadyActive;
      mikrotikActionId = reactivation.mikrotikAction?.id;

      // Vincular evento a la order
      await this.repo.markEventProcessed(eventId);
      logger.info('PaymentEngine: pago confirmado', {
        orderId: order.id, invoiceId: order.invoiceId, customerId: order.customerId, tenantId: orderTenantId,
      });
    } else if (provider === 'codi') {
      const reference = String(payload.reference ?? payload.referencia ?? '').toUpperCase();
      if (reference) {
        const invoiceId = reference.split('-')[0];
        const orders = await this.repo.listOrders({ invoiceId, tenantId });
        const order = orders.find((o) => o.provider === 'codi') ?? orders[0];
        if (order) {
          const orderTenantId = order.tenantId || 'tenant-default';
          await this.repo.updateOrderStatus(order.id, 'completed', undefined, orderTenantId);
          const invoiceResult = await this.confirmPaymentOnInvoice(order, orderTenantId);
          invoiceUpdated = invoiceResult.updated;
          const reactivation = await this.reactivateCustomerService(order.customerId, {
            triggeredBy: `webhook:codi:${providerEventId}`,
            invoiceId: order.invoiceId,
            tenantId: orderTenantId,
          });
          reactivationTriggered = !reactivation.alreadyActive;
          mikrotikActionId = reactivation.mikrotikAction?.id;
          await this.repo.markEventProcessed(eventId);
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
        if (invoice && invoice.status !== 'paid') {
          const invoiceTenantId = invoice.tenantId || 'tenant-default';
          const amount = Number(payload.amount ?? payload.monto ?? invoice.pendingAmount ?? invoice.amount);
          await billing.recordPayment(invoice.id, {
            amount,
            method: 'Transferencia',
            transactionId: providerEventId,
          }, invoiceTenantId);
          invoiceUpdated = true;
          const reactivation = await this.reactivateCustomerService(invoice.clientId, {
            triggeredBy: `webhook:codi:${providerEventId}`,
            invoiceId: invoice.id,
            tenantId: invoiceTenantId,
          });
          reactivationTriggered = !reactivation.alreadyActive;
          mikrotikActionId = reactivation.mikrotikAction?.id;
        }
      }
      await this.repo.markEventProcessed(eventId);
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
      await this.repo.markEventProcessed(eventId);
      logger.warn('PaymentEngine: webhook sin payment_order asociada', { provider, providerOrderId, tenantId });
    }

    return {
      eventId, idempotent: false, invoiceUpdated, reactivationTriggered, mikrotikActionId,
      message: invoiceUpdated
        ? 'Pago confirmado, factura actualizada y reactivación programada.'
        : 'Evento procesado (sin order asociada o factura ya pagada).',
    };
  }

  // ── Billing integration ───────────────────────────────────────────

  private async confirmPaymentOnInvoice(
    order: PaymentOrderRecord,
    tenantId?: string,
  ): Promise<{ updated: boolean }> {
    const billing = getBillingService();
    const effectiveTenantId = tenantId || order.tenantId || 'tenant-default';
    const invoice = await billing.findInvoiceById(order.invoiceId, effectiveTenantId);
    if (!invoice) {
      logger.warn('PaymentEngine: factura no encontrada para order', { invoiceId: order.invoiceId, tenantId: effectiveTenantId });
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
    }, effectiveTenantId);

    logger.info('PaymentEngine: factura marcada pagada', { invoiceId: order.invoiceId, tenantId: effectiveTenantId });
    return { updated: true };
  }

  // ── Reactivación lógica ───────────────────────────────────────────

  async reactivateCustomerService(
    customerId: string,
    context?: { triggeredBy?: string; invoiceId?: string; tenantId?: string },
  ): Promise<ReactivationResult> {
    if (!customerId?.trim()) throw new BadRequestError('customerId es obligatorio.');
    const tenantId = context?.tenantId || 'tenant-default';

    const dataProvider = buildPaymentDataProvider();
    const client = await dataProvider.getCustomer(customerId, tenantId);
    if (!client) throw new NotFoundError(`Cliente '${customerId}' no encontrado.`);

    // Idempotente: si ya está activo, no crear acción redundante
    if (client.status === 'active') {
      logger.info('PaymentEngine: cliente ya activo, reactivación omitida', { customerId, tenantId });
      return { customerId, alreadyActive: true, mikrotikAction: null, message: 'Cliente ya activo.' };
    }

    const routerLive = productionGates.paymentsRouterLive();
    const dryRun = !routerLive;

    // Cambio de estado lógico
    const prevStatus = client.status;
    await dataProvider.reactivateCustomer(customerId, tenantId);

    await getCustomersService().addTimelineEvent({
      clientId: customerId,
      eventType: 'status_change',
      summary: `Cambio de estado ${prevStatus} → active`,
      details: `Reactivación por pago confirmado. ${context?.invoiceId ? `Factura: ${context.invoiceId}.` : ''}${dryRun ? ' Pendiente ejecución en router (dry_run).' : ' Orden de reactivación encolada.'}`,
      createdBy: context?.triggeredBy ?? 'payment-engine',
    });

    const actionId = await this.repo.nextActionId();
    const routers = inventoryRoutersRepository.list();
    const router = routers.find((r) => r.encryptedPassword || r.hasCredentials) ?? routers[0];
    const actionRec: MikrotikActionRecord = {
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
      triggeredBy: context?.triggeredBy ?? 'payment-engine',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.repo.createAction(actionRec);

    if (routerLive) {
      await dispatchNetworkOrder({
        customerId,
        orderType: 'reactivation',
        source: 'payment-engine',
        reason: `Pago confirmado. Factura: ${context?.invoiceId ?? 'N/A'}`,
        actor: context?.triggeredBy ?? 'payment-engine',
      });
    }

    await getSuspensionService().repo.recordEvent({
      customerId,
      eventType: 'reactivation_order_created',
      reason: `Pago confirmado vía Payment Engine. Factura: ${context?.invoiceId ?? 'N/A'}.`,
      automatic: true,
      actorId: context?.triggeredBy ?? 'payment-engine',
      metadata: { dryRun, routerLive },
    });

    if (!isDomainOnDb('customers')) {
      store.createAlert(
        'client',
        'info',
        client.name,
        `Servicio reactivado por pago confirmado.${dryRun ? ' Acción MikroTik pendiente (dry_run).' : ' Orden de reactivación procesada.'}`,
      );
    }

    logger.info('PaymentEngine: reactivación completada', {
      customerId, actionId, dryRun,
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
