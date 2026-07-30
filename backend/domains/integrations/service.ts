import { randomBytes } from 'crypto';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import { getBillingService } from '../billing/service';
import { getCustomersService } from '../customers/service';
import { getNetworkService } from '../network/service';
import { getPaymentService } from '../payments/service';
import { DEFAULT_TENANT_ID } from '../tenancy/types';
import {
  applyIntegrationPatch,
  IntegrationsRepository,
  OpenPayWebhookOwner,
  StoreIntegrationsRepository,
  SupabaseIntegrationsRepository,
} from './repository';
import {
  buildIntegrationView,
  deliverInvoiceNotification,
  testOpenPayConnection,
  testStripeConnection,
  testTelegramConnection,
  testWhatsAppConnection,
} from './delivery';
import type { IntegrationProviderKey, IntegrationSettingsPatch } from './types';

// Token opaco (no secreto) para la URL de webhook por WISP.
const generateWebhookToken = (): string => randomBytes(24).toString('hex');

export class IntegrationsService {
  constructor(private readonly repo: IntegrationsRepository) {}

  async getSettingsView(tenantId?: string) {
    const rec = await this.repo.get(tenantId);
    return buildIntegrationView(rec);
  }

  async getSettingsRaw(tenantId?: string) {
    return this.repo.get(tenantId);
  }

  /** No sintetiza defaults: permite decidir si existe una fila persistida. */
  async getPersistedSettingsRaw(tenantId?: string) {
    return this.repo.getPersisted(tenantId);
  }

  /**
   * WISP dueño del token de webhook OpenPay. La resolución es exacta: un token
   * desconocido devuelve null, nunca la fila 'default' ni otro tenant.
   */
  async resolveOpenPayWebhookTenant(token: string): Promise<OpenPayWebhookOwner | null> {
    try {
      return await this.repo.findByOpenPayWebhookToken(token);
    } catch (error) {
      // Fail-closed: sin lookup fiable no se acepta el webhook. Nunca el token.
      logger.warn('Integrations: no se pudo resolver el WISP del webhook OpenPay', {
        reason: error instanceof Error ? error.message : 'error desconocido',
      });
      return null;
    }
  }

  async updateSettings(patch: IntegrationSettingsPatch, tenantId?: string) {
    const current = await this.repo.get(tenantId);
    const next = applyIntegrationPatch(current, patch);
    // Asigna un token de webhook estable al habilitar OpenPay (uno por WISP).
    if (next.openpayEnabled && !next.openpayWebhookToken) {
      next.openpayWebhookToken = generateWebhookToken();
    }
    const saved = await this.repo.save(next, tenantId);
    logger.info('Integrations: configuración actualizada', {
      tenantId: tenantId ?? 'default',
      stripe: saved.stripeEnabled,
      whatsapp: saved.whatsappEnabled,
      telegram: saved.telegramEnabled,
      codi: saved.codiEnabled,
      openpay: saved.openpayEnabled,
    });
    return buildIntegrationView(saved);
  }

  async testProvider(provider: IntegrationProviderKey, tenantId?: string) {
    const settings = await this.repo.get(tenantId);
    if (provider === 'stripe') return testStripeConnection(settings);
    if (provider === 'whatsapp') return testWhatsAppConnection(settings);
    if (provider === 'telegram') return testTelegramConnection(settings);
    if (provider === 'openpay') return testOpenPayConnection(settings);
    if (provider === 'codi') {
      const ok =
        settings.codiEnabled &&
        settings.codiClabe.trim().length >= 18 &&
        settings.codiBeneficiaryName.trim().length > 0;
      return {
        sent: ok,
        provider: 'codi',
        channel: 'CODI',
        preview: ok ? `CLABE ${settings.codiClabe.slice(-4).padStart(settings.codiClabe.length, '*')}` : undefined,
        error: ok ? undefined : 'Complete beneficiario y CLABE de 18 dígitos',
      };
    }
    throw new BadRequestError(`Proveedor no soportado: ${provider}`);
  }

  async notifyInvoice(invoiceId: string, tenantId?: string) {
    const billing = getBillingService();
    const invoice = await billing.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundError('Factura no encontrada');

    const client = await getCustomersService().getById(invoice.clientId);
    if (!client) throw new NotFoundError('Cliente no encontrado');

    const channel = client.notificationChannel || 'whatsapp';
    const settings = await this.repo.get(tenantId);
    const billingCycleLabel = await this.resolveBillingCycleLabel(client.billingZoneId);

    const paymentReference = `${invoice.id}-${client.id}`.toUpperCase();
    const result = await deliverInvoiceNotification(settings, {
      clientId: client.id,
      clientName: client.name,
      phone: client.phone,
      telegramChatId: client.telegramChatId,
      channel,
      invoiceId: invoice.id,
      amount: invoice.pendingAmount > 0 ? invoice.pendingAmount : invoice.amount,
      dueDate: invoice.dueDateStr,
      paymentReference,
      billingCycleLabel,
    });

    await getCustomersService().addTimelineEvent({
      clientId: client.id,
      eventType: 'note',
      summary: `Factura enviada por ${channel}`,
      details: result.sent
        ? `Notificación entregada vía ${result.provider}.`
        : `No entregada: ${result.error || 'sin detalle'}`,
      createdBy: 'integrations',
    });

    return {
      clientId: client.id,
      channel,
      sent: result.sent,
      provider: result.provider,
      messagePreview: result.preview || '',
      error: result.error,
    };
  }

  async processCodiWebhook(payload: Record<string, unknown>, signature: string, tenantId?: string) {
    // El WISP queda explícito: sin tenant, el evento es del WISP por defecto.
    const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
    const settings = await this.repo.get(effectiveTenantId);
    if (!settings.codiEnabled) {
      return { accepted: false, message: 'CoDi deshabilitado' };
    }
    if (settings.codiWebhookSecret && signature !== settings.codiWebhookSecret) {
      return { accepted: false, message: 'Firma inválida' };
    }

    const eventId = String(payload.event_id || payload.id || payload.tracking_key || Date.now());
    const eventType = String(payload.event_type || payload.status || 'codi.payment.completed');
    const amount = Number(payload.amount ?? payload.monto ?? 0);
    const reference = String(
      payload.reference || payload.referencia || payload.concept || payload.invoice_id || '',
    ).toUpperCase();

    const payment = getPaymentService();
    const result = await payment.processWebhook({
      provider: 'codi',
      providerEventId: eventId,
      eventType,
      payload: { ...payload, amount, reference, status: 'paid' },
      // Idempotencia y búsqueda de order acotadas al WISP que recibe el evento.
      tenantId: effectiveTenantId,
    });

    return {
      accepted: result.idempotentReason !== 'in_progress',
      ...result,
    };
  }

  private async resolveBillingCycleLabel(zoneId?: string): Promise<string | undefined> {
    if (!zoneId?.trim()) return undefined;
    try {
      const towers = await getNetworkService().listTowers({});
      const tower = towers.find((t) => t.id === zoneId || t.name === zoneId);
      if (!tower) return zoneId;
      const onboarding = await getNetworkService().getTowerOnboarding(tower.id);
      if (!onboarding?.billingCycleDay) return tower.name;
      const time = onboarding.billingCycleTime || '00:00';
      return `${tower.name} · día ${onboarding.billingCycleDay} ${time}`;
    } catch {
      return zoneId;
    }
  }
}

let singleton: IntegrationsService | null = null;

export const getIntegrationsService = (): IntegrationsService => {
  if (!singleton) {
    const repo =
      isSupabaseAdminConfigured && supabaseAdmin
        ? new SupabaseIntegrationsRepository(supabaseAdmin)
        : new StoreIntegrationsRepository();
    singleton = new IntegrationsService(repo);
  }
  return singleton;
};

export const resetIntegrationsService = (): void => {
  singleton = null;
};
