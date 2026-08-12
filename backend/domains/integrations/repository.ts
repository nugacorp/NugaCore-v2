import type { SupabaseClient } from '@supabase/supabase-js';
import { store } from '../../state/store';
import type { IntegrationSettingsPatch, IntegrationSettingsRecord } from './types';
import { logger } from '../../common/logger';
import { nowIso } from '../../common/time';
import { encryptSecret, decryptSecret } from '../../services/crypto';
import { DEFAULT_TENANT_ID } from '../tenancy/types';

const DEFAULT_ID = 'default';

/**
 * WISP canónico de una petición. La ausencia de tenant es el WISP por defecto;
 * es la única regla implícita que queda y está acotada a este punto.
 */
export const resolveTenantId = (tenantId?: string): string =>
  tenantId?.trim() ? tenantId.trim() : DEFAULT_TENANT_ID;

/**
 * Fila de settings del WISP. tenant-default (o ausencia de tenant) mapea a la
 * fila legacy 'default'; cada otro WISP tiene su propia fila `id = tenantId`.
 *
 * Sigue existiendo porque la columna `id` es la PK de la tabla y hay que
 * escribirla coherente durante la transición, pero NO es la clave de scoping:
 * leer o upsertar por `id` es exactamente el fallo que corrige MT-03.
 */
export const resolveSettingsId = (tenantId?: string): string => {
  const canonical = resolveTenantId(tenantId);
  return canonical === DEFAULT_TENANT_ID ? DEFAULT_ID : canonical;
};

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
  tenantId: DEFAULT_TENANT_ID,
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
  openpayWebhookToken: '',
  updatedAt: nowIso(),
});

const rowToRecord = (row: Record<string, unknown>): IntegrationSettingsRecord => ({
  id: String(row.id ?? DEFAULT_ID),
  // Sin `tenant_id` la fila es anterior a la migración de canonicalización y no
  // se puede afirmar de quién es. Se deja vacío a propósito: los llamadores
  // comparan contra el WISP pedido y rechazan, en vez de adivinar tenant-default.
  tenantId: String(row.tenant_id ?? ''),
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
  openpayWebhookToken: String(row.openpay_webhook_token ?? ''),
  updatedAt: String(row.updated_at ?? nowIso()),
});

const recordToRow = (rec: IntegrationSettingsRecord) => ({
  id: rec.id,
  // Identidad canónica: sin esto la DB etiqueta la fila con su DEFAULT y una
  // configuración de tenant-b acaba marcada como tenant-default (MT-03).
  tenant_id: rec.tenantId,
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
  openpay_webhook_token: rec.openpayWebhookToken || null,
  updated_at: rec.updatedAt,
});

/**
 * Última barrera antes de entregar credenciales: la fila tiene que declararse
 * del WISP que se pidió. Cubre el filtro roto, la fila legacy sin estampar y el
 * upsert que resolvió por la columna equivocada — todos casos en los que el
 * llamador recibiría secretos ajenos sin enterarse.
 */
const assertOwnedBy = (rec: IntegrationSettingsRecord, expected: string): void => {
  if (rec.tenantId === expected) return;
  throw new Error(
    `Integrations: la fila de settings no pertenece al WISP solicitado (tenant esperado ${expected}, fila ${rec.tenantId || 'sin tenant_id'})`,
  );
};

/**
 * Valida un record del store contra la ubicación en que fue encontrado.
 * `tenantId` es la autoridad; la única normalización permitida es la fila
 * histórica `id=default`, anterior al stamp canónico.
 */
const normalizeStoreOwnedRecord = (
  rec: IntegrationSettingsRecord | null | undefined,
  expectedTenantId: string,
): IntegrationSettingsRecord | null => {
  if (!rec) return null;
  const stampedTenantId = String(rec.tenantId ?? '').trim();
  if (!stampedTenantId) {
    if (expectedTenantId === DEFAULT_TENANT_ID && rec.id === DEFAULT_ID) {
      return { ...rec, tenantId: DEFAULT_TENANT_ID };
    }
    return null;
  }
  return stampedTenantId === expectedTenantId
    ? { ...rec, tenantId: stampedTenantId }
    : null;
};

/** WISP dueño de un token de webhook, con su fila de settings. */
export interface OpenPayWebhookOwner {
  tenantId: string;
  settings: IntegrationSettingsRecord;
}

export interface IntegrationsRepository {
  get(tenantId?: string): Promise<IntegrationSettingsRecord>;
  /** Fila realmente persistida; null no se confunde con el record vacío de lectura/UI. */
  getPersisted(tenantId?: string): Promise<IntegrationSettingsRecord | null>;
  save(rec: IntegrationSettingsRecord, tenantId?: string): Promise<IntegrationSettingsRecord>;
  /**
   * Resuelve el WISP dueño de un token de webhook OpenPay. Devuelve null si el
   * token no existe: nunca cae a otro tenant ni a la fila 'default'.
   */
  findByOpenPayWebhookToken(token: string): Promise<OpenPayWebhookOwner | null>;
}

export class StoreIntegrationsRepository implements IntegrationsRepository {
  async get(tenantId?: string): Promise<IntegrationSettingsRecord> {
    const canonical = resolveTenantId(tenantId);
    return (
      (await this.getPersisted(tenantId)) ?? {
        ...emptyIntegrationSettings(),
        id: resolveSettingsId(tenantId),
        tenantId: canonical,
      }
    );
  }

  async getPersisted(tenantId?: string): Promise<IntegrationSettingsRecord | null> {
    const canonical = resolveTenantId(tenantId);
    const id = resolveSettingsId(tenantId);
    const rec = id === DEFAULT_ID
      ? store.INTEGRATION_SETTINGS
      : store.INTEGRATION_SETTINGS_BY_TENANT[id];
    return normalizeStoreOwnedRecord(rec, canonical);
  }

  async findByOpenPayWebhookToken(token: string): Promise<OpenPayWebhookOwner | null> {
    const needle = String(token ?? '').trim();
    if (!needle) return null;
    const rows: Array<{ expectedTenantId: string; settings: IntegrationSettingsRecord }> = [
      ...(store.INTEGRATION_SETTINGS
        ? [{ expectedTenantId: DEFAULT_TENANT_ID, settings: store.INTEGRATION_SETTINGS }]
        : []),
      ...Object.entries(store.INTEGRATION_SETTINGS_BY_TENANT).map(([key, settings]) => ({
        expectedTenantId: resolveTenantId(key),
        settings,
      })),
    ];
    const matches = rows.filter(
      ({ settings }) => Boolean(settings.openpayWebhookToken) && settings.openpayWebhookToken === needle,
    );
    if (matches.length !== 1) return null;
    const match = matches[0];
    const settings = normalizeStoreOwnedRecord(match.settings, match.expectedTenantId);
    return settings ? { tenantId: settings.tenantId, settings } : null;
  }

  async save(rec: IntegrationSettingsRecord, tenantId?: string): Promise<IntegrationSettingsRecord> {
    const id = resolveSettingsId(tenantId);
    const stored = { ...rec, id, tenantId: resolveTenantId(tenantId) };
    if (id === DEFAULT_ID) {
      store.INTEGRATION_SETTINGS = stored;
    } else {
      store.INTEGRATION_SETTINGS_BY_TENANT[id] = stored;
    }
    return stored;
  }
}

export class SupabaseIntegrationsRepository implements IntegrationsRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async get(tenantId?: string): Promise<IntegrationSettingsRecord> {
    const canonical = resolveTenantId(tenantId);
    return (
      (await this.getPersisted(tenantId)) ?? {
        ...emptyIntegrationSettings(),
        id: resolveSettingsId(tenantId),
        tenantId: canonical,
      }
    );
  }

  async getPersisted(tenantId?: string): Promise<IntegrationSettingsRecord | null> {
    const canonical = resolveTenantId(tenantId);
    // El scoping va por `tenant_id`, la identidad canónica. El backend habla
    // con Supabase como service_role, así que RLS no acota nada aquí: si el
    // filtro no es correcto, no hay segunda barrera.
    const { data, error } = await this.admin
      .from('wisp_integration_settings')
      .select('*')
      .eq('tenant_id', canonical)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) return null;
    const rec = rowToRecord(data as Record<string, unknown>);
    assertOwnedBy(rec, canonical);
    return rec;
  }

  async findByOpenPayWebhookToken(token: string): Promise<OpenPayWebhookOwner | null> {
    const needle = String(token ?? '').trim();
    if (!needle) return null;
    // `limit(2)`: si por alguna razón dos WISPs comparten token, no se elige uno
    // arbitrariamente — se rechaza (fail-closed). El índice único lo previene.
    const { data, error } = await this.admin
      .from('wisp_integration_settings')
      .select('*')
      .eq('openpay_webhook_token', needle)
      .limit(2);
    if (error) {
      // Jamás se registra el token; solo el motivo.
      logger.warn('Integrations: lookup de token de webhook OpenPay falló', {
        reason: String(error.message || error.code || 'error desconocido'),
      });
      return null;
    }
    if (!data || data.length !== 1) return null;
    const rec = rowToRecord(data[0] as Record<string, unknown>);
    // El dueño sale de la columna canónica. Una fila sin `tenant_id` es previa
    // a la migración: no se resuelve a nadie antes que atribuirla al WISP
    // equivocado y cobrarle el webhook a otro.
    if (!rec.tenantId) {
      logger.warn('Integrations: fila de webhook OpenPay sin tenant_id canónico', { settingsId: rec.id });
      return null;
    }
    return { tenantId: rec.tenantId, settings: rec };
  }

  async save(rec: IntegrationSettingsRecord, tenantId?: string): Promise<IntegrationSettingsRecord> {
    const canonical = resolveTenantId(tenantId);
    const row = recordToRow({ ...rec, id: resolveSettingsId(tenantId), tenantId: canonical });
    // `onConflict: 'tenant_id'` — el índice único de la migración. Con
    // `onConflict: 'id'` un WISP podría pisar la fila de otro cuya PK legacy
    // coincidiera; el WISP dueño es lo que decide el destino de la escritura.
    const { data, error } = await this.admin
      .from('wisp_integration_settings')
      .upsert(row, { onConflict: 'tenant_id' })
      .select('*')
      .single();
    if (error) throw error;
    const saved = rowToRecord(data as Record<string, unknown>);
    assertOwnedBy(saved, canonical);
    return saved;
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
