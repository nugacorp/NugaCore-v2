import type { SupabaseClient } from '@supabase/supabase-js';
import { store } from '../../state/store';
import type { IntegrationSettingsPatch, IntegrationSettingsRecord } from './types';
import { nowIso } from '../../common/time';

const DEFAULT_ID = 'default';

export const emptyIntegrationSettings = (): IntegrationSettingsRecord => ({
  id: DEFAULT_ID,
  stripeEnabled: false,
  stripePublishableKey: '',
  stripeSecretKey: '',
  stripeWebhookSecret: '',
  whatsappEnabled: false,
  whatsappPhoneNumberId: '',
  whatsappAccessToken: '',
  whatsappBusinessAccountId: '',
  whatsappWebhookVerifyToken: '',
  telegramEnabled: false,
  telegramBotToken: '',
  telegramBotUsername: '',
  codiEnabled: false,
  codiMerchantId: '',
  codiBeneficiaryName: '',
  codiClabe: '',
  codiWebhookSecret: '',
  codiCertificateRef: '',
  updatedAt: nowIso(),
});

const rowToRecord = (row: Record<string, unknown>): IntegrationSettingsRecord => ({
  id: String(row.id ?? DEFAULT_ID),
  stripeEnabled: Boolean(row.stripe_enabled),
  stripePublishableKey: String(row.stripe_publishable_key ?? ''),
  stripeSecretKey: String(row.stripe_secret_key ?? ''),
  stripeWebhookSecret: String(row.stripe_webhook_secret ?? ''),
  whatsappEnabled: Boolean(row.whatsapp_enabled),
  whatsappPhoneNumberId: String(row.whatsapp_phone_number_id ?? ''),
  whatsappAccessToken: String(row.whatsapp_access_token ?? ''),
  whatsappBusinessAccountId: String(row.whatsapp_business_account_id ?? ''),
  whatsappWebhookVerifyToken: String(row.whatsapp_webhook_verify_token ?? ''),
  telegramEnabled: Boolean(row.telegram_enabled),
  telegramBotToken: String(row.telegram_bot_token ?? ''),
  telegramBotUsername: String(row.telegram_bot_username ?? ''),
  codiEnabled: Boolean(row.codi_enabled),
  codiMerchantId: String(row.codi_merchant_id ?? ''),
  codiBeneficiaryName: String(row.codi_beneficiary_name ?? ''),
  codiClabe: String(row.codi_clabe ?? ''),
  codiWebhookSecret: String(row.codi_webhook_secret ?? ''),
  codiCertificateRef: String(row.codi_certificate_ref ?? ''),
  updatedAt: String(row.updated_at ?? nowIso()),
});

const recordToRow = (rec: IntegrationSettingsRecord) => ({
  id: rec.id,
  stripe_enabled: rec.stripeEnabled,
  stripe_publishable_key: rec.stripePublishableKey || null,
  stripe_secret_key: rec.stripeSecretKey || null,
  stripe_webhook_secret: rec.stripeWebhookSecret || null,
  whatsapp_enabled: rec.whatsappEnabled,
  whatsapp_phone_number_id: rec.whatsappPhoneNumberId || null,
  whatsapp_access_token: rec.whatsappAccessToken || null,
  whatsapp_business_account_id: rec.whatsappBusinessAccountId || null,
  whatsapp_webhook_verify_token: rec.whatsappWebhookVerifyToken || null,
  telegram_enabled: rec.telegramEnabled,
  telegram_bot_token: rec.telegramBotToken || null,
  telegram_bot_username: rec.telegramBotUsername || null,
  codi_enabled: rec.codiEnabled,
  codi_merchant_id: rec.codiMerchantId || null,
  codi_beneficiary_name: rec.codiBeneficiaryName || null,
  codi_clabe: rec.codiClabe || null,
  codi_webhook_secret: rec.codiWebhookSecret || null,
  codi_certificate_ref: rec.codiCertificateRef || null,
  updated_at: rec.updatedAt,
});

export interface IntegrationsRepository {
  get(): Promise<IntegrationSettingsRecord>;
  save(rec: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord>;
}

export class StoreIntegrationsRepository implements IntegrationsRepository {
  async get(): Promise<IntegrationSettingsRecord> {
    return store.INTEGRATION_SETTINGS ?? emptyIntegrationSettings();
  }

  async save(rec: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord> {
    store.INTEGRATION_SETTINGS = rec;
    return rec;
  }
}

export class SupabaseIntegrationsRepository implements IntegrationsRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async get(): Promise<IntegrationSettingsRecord> {
    const { data, error } = await this.admin
      .from('wisp_integration_settings')
      .select('*')
      .eq('id', DEFAULT_ID)
      .maybeSingle();
    if (error) {
      if (String(error.code) === '42P01' || String(error.message).includes('does not exist')) {
        return emptyIntegrationSettings();
      }
      throw error;
    }
    return data ? rowToRecord(data as Record<string, unknown>) : emptyIntegrationSettings();
  }

  async save(rec: IntegrationSettingsRecord): Promise<IntegrationSettingsRecord> {
    const { data, error } = await this.admin
      .from('wisp_integration_settings')
      .upsert(recordToRow(rec), { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw error;
    return rowToRecord(data as Record<string, unknown>);
  }
}

export const applyIntegrationPatch = (
  current: IntegrationSettingsRecord,
  patch: IntegrationSettingsPatch,
): IntegrationSettingsRecord => {
  const next = { ...current, updatedAt: nowIso() };
  if (patch.stripe) {
    if (patch.stripe.enabled !== undefined) next.stripeEnabled = patch.stripe.enabled;
    if (patch.stripe.publishableKey !== undefined) next.stripePublishableKey = patch.stripe.publishableKey;
    if (patch.stripe.secretKey?.trim()) next.stripeSecretKey = patch.stripe.secretKey.trim();
    if (patch.stripe.webhookSecret?.trim()) next.stripeWebhookSecret = patch.stripe.webhookSecret.trim();
  }
  if (patch.whatsapp) {
    if (patch.whatsapp.enabled !== undefined) next.whatsappEnabled = patch.whatsapp.enabled;
    if (patch.whatsapp.phoneNumberId !== undefined) next.whatsappPhoneNumberId = patch.whatsapp.phoneNumberId;
    if (patch.whatsapp.businessAccountId !== undefined) {
      next.whatsappBusinessAccountId = patch.whatsapp.businessAccountId;
    }
    if (patch.whatsapp.accessToken?.trim()) next.whatsappAccessToken = patch.whatsapp.accessToken.trim();
    if (patch.whatsapp.webhookVerifyToken?.trim()) {
      next.whatsappWebhookVerifyToken = patch.whatsapp.webhookVerifyToken.trim();
    }
  }
  if (patch.telegram) {
    if (patch.telegram.enabled !== undefined) next.telegramEnabled = patch.telegram.enabled;
    if (patch.telegram.botUsername !== undefined) next.telegramBotUsername = patch.telegram.botUsername;
    if (patch.telegram.botToken?.trim()) next.telegramBotToken = patch.telegram.botToken.trim();
  }
  if (patch.codi) {
    if (patch.codi.enabled !== undefined) next.codiEnabled = patch.codi.enabled;
    if (patch.codi.merchantId !== undefined) next.codiMerchantId = patch.codi.merchantId;
    if (patch.codi.beneficiaryName !== undefined) next.codiBeneficiaryName = patch.codi.beneficiaryName;
    if (patch.codi.clabe !== undefined) next.codiClabe = patch.codi.clabe;
    if (patch.codi.certificateRef !== undefined) next.codiCertificateRef = patch.codi.certificateRef;
    if (patch.codi.webhookSecret?.trim()) next.codiWebhookSecret = patch.codi.webhookSecret.trim();
  }
  return next;
};
