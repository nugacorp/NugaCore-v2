import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import { getBillingService } from '../billing/service';
import { getCustomersService } from '../customers/service';
import { getNetworkService } from '../network/service';
import { getPaymentService } from '../payments/service';
import {
  applyIntegrationPatch,
  emptyIntegrationSettings,
  IntegrationsRepository,
  StoreIntegrationsRepository,
  SupabaseIntegrationsRepository,
} from './repository';
import {
  buildIntegrationView,
  deliverInvoiceNotification,
  testStripeConnection,
  testTelegramConnection,
  testWhatsAppConnection,
} from './delivery';
import type { IntegrationProviderKey, IntegrationSettingsPatch } from './types';

export class IntegrationsService {
  constructor(private readonly repo: IntegrationsRepository) {}

  async getSettingsView() {
    const rec = await this.repo.get();
    return buildIntegrationView(rec);
  }

  async getSettingsRaw() {
    return this.repo.get();
  }

  async updateSettings(patch: IntegrationSettingsPatch) {
    const current = await this.repo.get();
    const next = applyIntegrationPatch(current, patch);
    const saved = await this.repo.save(next);
    logger.info('Integrations: configuración actualizada', {
      stripe: saved.stripeEnabled,
      whatsapp: saved.whatsappEnabled,
      telegram: saved.telegramEnabled,
      codi: saved.codiEnabled,
    });
    return buildIntegrationView(saved);
  }

  async testProvider(provider: IntegrationProviderKey) {
    const settings = await this.repo.get();
    if (provider === 'stripe') return testStripeConnection(settings);
    if (provider === 'whatsapp') return testWhatsAppConnection(settings);
    if (provider === 'telegram') return testTelegramConnection(settings);
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

  async notifyInvoice(invoiceId: string) {
    const billing = getBillingService();
    const invoice = await billing.findInvoiceById(invoiceId);
    if (!invoice) throw new NotFoundError('Factura no encontrada');

    const client = await getCustomersService().getById(invoice.clientId);
    if (!client) throw new NotFoundError('Cliente no encontrado');

    const channel = client.notificationChannel || 'whatsapp';
    const settings = await this.repo.get();
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

  async processCodiWebhook(payload: Record<string, unknown>, signature: string) {
    const settings = await this.repo.get();
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
    });

    return { accepted: true, ...result };
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
