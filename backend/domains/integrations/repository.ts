import type { SupabaseClient } from '@supabase/supabase-js';
import { store } from '../../state/store';
import type { IntegrationSettingsPatch, IntegrationSettingsRecord } from './types';
import { nowIso } from '../../common/time';
import { encryptSecret, decryptSecret } from '../../services/crypto';

const DEFAULT_ID = 'default';

// Cifrado en reposo de credenciales (AES-256-GCM, reutiliza MIKROTIK_CREDENTIALS_KEY).
// Solo se aplica en el límite con la DB (rowToRecord/recordToRow): el record en
// memoria y el store siempre manejan texto plano. Únicamente las credenciales reales
// se cifran; CLABE/merchant/beneficiario NO (son datos que el cliente ve para pagar).
const encField = (value: string): string | null => {
  const v = (value ?? '').trim();
  return v ? encryptSecret(v) : null;
};

// Tolera valores legacy en texto plano: si no descifra (formato inválido o auth tag
// que no coincide), se devuelve tal cual. Así la migración a cifrado no rompe filas
// escritas antes de este cambio.
const decField = (value: unknown): string => {
  const raw = String(value ?? '');
  if (!raw) return '';
  try {
    return decryptSecret(raw);
  } catch {
    return raw;
  }
};

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
  openpayEnabled: false,
  openpayMerchantId: '',
  openpayPublicKey: '',
  openpayPrivateKey: '',
  openpayWebhookSecret: '',
  openpaySandbox: true,
  updatedAt: nowIso(),
});

const rowToRecord = (row: Record<string, unknown>): IntegrationSettingsRecord => ({
  id: String(row.id ?? DEFAULT_ID),
  stripeEnabled: Boolean(row.stripe_enabled),
  stripePublishableKey: String(row.stripe_publishable_key ?? ''),
  stripeSecretKey: decField(row.stripe_secret_key),
  stripeWebhookSecret: decField(row.stripe_webhook_secret),
  whatsappEnabled: Boolean(row.whatsapp_enabled),
  whatsappPhoneNumberId: String(row.whatsapp_phone_number_id ?? ''),
  whatsappAccessToken: decField(row.whatsapp_access_token),
  whatsappBusinessAccountId: String(row.whatsapp_business_account_id ?? ''),
  whatsappWebhookVerifyToken: decField(row.whatsapp_webhook_verify_token),
  telegramEnabled: Boolean(row.telegram_enabled),
  telegramBotToken: decField(row.telegram_bot_token),
  telegramBotUsername: String(row.telegram_bot_username ?? ''),
  codiEnabled: Boolean(row.codi_enabled),
  codiMerchantId: String(row.codi_merchant_id ?? ''),
  codiBeneficiaryName: String(row.codi_beneficiary_name ?? ''),
  codiClabe: String(row.codi_clabe ?? ''),
  codiWebhookSecret: decField(row.codi_webhook_secret),
  codiCertificateRef: String(row.codi_certificate_ref ?? ''),
  openpayEnabled: Boolean(row.openpay_enabled),
  openpayMerchantId: String(row.openpay_merchant_id ?? ''),
  openpayPublicKey: String(row.openpay_public_key ?? ''),
  openpayPrivateKey: decField(row.openpay_private_key),
  openpayWebhookSecret: decField(row.openpay_webhook_secret),
  openpaySandbox: row.openpay_sandbox === undefined || row.openpay_sandbox === null
    ? true
    : Boolean(row.openpay_sandbox),
  updatedAt: String(row.updated_at ?? nowIso()),
});

const recordToRow = (rec: IntegrationSettingsRecord) => ({
  id: rec.id,
  stripe_enabled: rec.stripeEnabled,
  stripe_publishable_key: rec.stripePublishableKey || null,
  stripe_secret_key: encField(rec.stripeSecretKey),
  stripe_webhook_secret: encField(rec.stripeWebhookSecret),
  whatsapp_enabled: rec.whatsappEnabled,
  whatsapp_phone_number_id: rec.whatsappPhoneNumberId || null,
  whatsapp_access_token: encField(rec.whatsappAccessToken),
  whatsapp_business_account_id: rec.whatsappBusinessAccountId || null,
  whatsapp_webhook_verify_token: encField(rec.whatsappWebhookVerifyToken),
  telegram_enabled: rec.telegramEnabled,
  telegram_bot_token: encField(rec.telegramBotToken),
  telegram_bot_username: rec.telegramBotUsername || null,
  codi_enabled: rec.codiEnabled,
  codi_merchant_id: rec.codiMerchantId || null,
  codi_beneficiary_name: rec.codiBeneficiaryName || null,
  codi_clabe: rec.codiClabe || null,
  codi_webhook_secret: encField(rec.codiWebhookSecret),
  codi_certificate_ref: rec.codiCertificateRef || null,
  openpay_enabled: rec.openpayEnabled,
  openpay_merchant_id: rec.openpayMerchantId || null,
  openpay_public_key: rec.openpayPublicKey || null,
  openpay_private_key: encField(rec.openpayPrivateKey),
  openpay_webhook_secret: encField(rec.openpayWebhookSecret),
  openpay_sandbox: rec.openpaySandbox,
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
  if (patch.openpay) {
    if (patch.openpay.enabled !== undefined) next.openpayEnabled = patch.openpay.enabled;
    if (patch.openpay.merchantId !== undefined) next.openpayMerchantId = patch.openpay.merchantId;
    if (patch.openpay.publicKey !== undefined) next.openpayPublicKey = patch.openpay.publicKey;
    if (patch.openpay.sandbox !== undefined) next.openpaySandbox = patch.openpay.sandbox;
    if (patch.openpay.privateKey?.trim()) next.openpayPrivateKey = patch.openpay.privateKey.trim();
    if (patch.openpay.webhookSecret?.trim()) next.openpayWebhookSecret = patch.openpay.webhookSecret.trim();
  }
  return next;
};
