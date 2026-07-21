import { productionGates } from '../../config/production-gates';
import type { IntegrationSettingsRecord, DeliveryResult, InvoiceNotifyPayload } from './types';

const maskSecret = (value: string): boolean => value.trim().length > 0;

export const buildIntegrationView = (rec: IntegrationSettingsRecord) => {
  const stripeConfigured = maskSecret(rec.stripeSecretKey) && rec.stripePublishableKey.trim().length > 0;
  const whatsappConfigured =
    maskSecret(rec.whatsappAccessToken) && rec.whatsappPhoneNumberId.trim().length > 0;
  const telegramConfigured = maskSecret(rec.telegramBotToken);
  const codiConfigured =
    rec.codiClabe.trim().length >= 18 && rec.codiBeneficiaryName.trim().length > 0;
  const openpayConfigured =
    rec.openpayMerchantId.trim().length > 0 && maskSecret(rec.openpayPrivateKey);

  const status = (
    enabled: boolean,
    configured: boolean,
    connectedLabel: string,
    missingLabel: string,
  ) => ({
    enabled,
    configured,
    statusLabel: enabled && configured ? connectedLabel : missingLabel,
    detail: enabled && !configured ? 'Faltan credenciales' : undefined,
  });

  return {
    stripe: {
      enabled: rec.stripeEnabled,
      publishableKey: rec.stripePublishableKey,
      secretKeySet: maskSecret(rec.stripeSecretKey),
      webhookSecretSet: maskSecret(rec.stripeWebhookSecret),
    },
    whatsapp: {
      enabled: rec.whatsappEnabled,
      phoneNumberId: rec.whatsappPhoneNumberId,
      businessAccountId: rec.whatsappBusinessAccountId,
      accessTokenSet: maskSecret(rec.whatsappAccessToken),
      webhookVerifyTokenSet: maskSecret(rec.whatsappWebhookVerifyToken),
    },
    telegram: {
      enabled: rec.telegramEnabled,
      botUsername: rec.telegramBotUsername,
      botTokenSet: maskSecret(rec.telegramBotToken),
    },
    codi: {
      enabled: rec.codiEnabled,
      merchantId: rec.codiMerchantId,
      beneficiaryName: rec.codiBeneficiaryName,
      clabe: rec.codiClabe,
      webhookSecretSet: maskSecret(rec.codiWebhookSecret),
      certificateRef: rec.codiCertificateRef,
    },
    openpay: {
      enabled: rec.openpayEnabled,
      merchantId: rec.openpayMerchantId,
      publicKey: rec.openpayPublicKey,
      privateKeySet: maskSecret(rec.openpayPrivateKey),
      webhookSecretSet: maskSecret(rec.openpayWebhookSecret),
      sandbox: rec.openpaySandbox,
    },
    mikrotik: {
      note: 'Puerto API 8728 — configurar routers en Inventario / Red',
    },
    statuses: {
      stripe: status(rec.stripeEnabled, stripeConfigured, 'Conectado', 'No conectado'),
      whatsapp: status(rec.whatsappEnabled, whatsappConfigured, 'Conectado', 'No conectado'),
      telegram: status(rec.telegramEnabled, telegramConfigured, 'Conectado', 'No conectado'),
      codi: status(rec.codiEnabled, codiConfigured, 'Listo para cobros SPEI/CoDi', 'No configurado'),
      openpay: status(
        rec.openpayEnabled,
        openpayConfigured,
        rec.openpaySandbox ? 'Conectado (sandbox)' : 'Conectado (producción)',
        'No configurado',
      ),
      mikrotik: {
        enabled: true,
        configured: true,
        statusLabel: 'Ver módulo Red',
        detail: 'Port 8728',
      },
    },
  };
};

export async function sendWhatsAppMessage(
  settings: IntegrationSettingsRecord,
  toPhone: string,
  body: string,
): Promise<DeliveryResult> {
  if (!settings.whatsappEnabled || !settings.whatsappAccessToken || !settings.whatsappPhoneNumberId) {
    return { sent: false, provider: 'whatsapp', channel: 'WHATSAPP', error: 'WhatsApp no configurado' };
  }
  if (!productionGates.notificationsLive()) {
    return {
      sent: false,
      provider: 'whatsapp-dry-run',
      channel: 'WHATSAPP',
      preview: body,
      error: 'NOTIFICATIONS_LIVE=false',
    };
  }
  const digits = toPhone.replace(/\D/g, '');
  if (!digits) return { sent: false, provider: 'whatsapp', channel: 'WHATSAPP', error: 'Teléfono inválido' };

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${settings.whatsappPhoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits,
        type: 'text',
        text: { body },
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  if (!res.ok) {
    return {
      sent: false,
      provider: 'whatsapp',
      channel: 'WHATSAPP',
      error: data.error?.message || `HTTP ${res.status}`,
    };
  }
  return {
    sent: true,
    provider: 'whatsapp-cloud-api',
    channel: 'WHATSAPP',
    messageId: data.messages?.[0]?.id,
    preview: body,
  };
}

export async function sendTelegramMessage(
  settings: IntegrationSettingsRecord,
  chatId: string,
  body: string,
): Promise<DeliveryResult> {
  if (!settings.telegramEnabled || !settings.telegramBotToken) {
    return { sent: false, provider: 'telegram', channel: 'TELEGRAM', error: 'Telegram no configurado' };
  }
  if (!chatId?.trim()) {
    return { sent: false, provider: 'telegram', channel: 'TELEGRAM', error: 'telegram_chat_id requerido' };
  }
  if (!productionGates.notificationsLive()) {
    return {
      sent: false,
      provider: 'telegram-dry-run',
      channel: 'TELEGRAM',
      preview: body,
      error: 'NOTIFICATIONS_LIVE=false',
    };
  }
  const res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'HTML' }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
  if (!res.ok || !data.ok) {
    return {
      sent: false,
      provider: 'telegram',
      channel: 'TELEGRAM',
      error: data.description || `HTTP ${res.status}`,
    };
  }
  return {
    sent: true,
    provider: 'telegram-bot-api',
    channel: 'TELEGRAM',
    messageId: data.result?.message_id ? String(data.result.message_id) : undefined,
    preview: body,
  };
}

export function buildInvoiceMessage(payload: InvoiceNotifyPayload): string {
  const cycle = payload.billingCycleLabel ? `\nCorte de zona: ${payload.billingCycleLabel}` : '';
  return [
    `Hola ${payload.clientName},`,
    '',
    `Factura ${payload.invoiceId}`,
    `Monto: $${payload.amount.toFixed(2)} MXN`,
    `Vence: ${payload.dueDate}`,
    `Referencia de pago / CoDi: ${payload.paymentReference}`,
    cycle,
    '',
    'Gracias por su preferencia.',
  ].join('\n');
}

export async function deliverInvoiceNotification(
  settings: IntegrationSettingsRecord,
  payload: InvoiceNotifyPayload,
): Promise<DeliveryResult> {
  const body = buildInvoiceMessage(payload);
  if (payload.channel === 'telegram') {
    return sendTelegramMessage(settings, payload.telegramChatId || '', body);
  }
  if (payload.channel === 'whatsapp' || payload.channel === 'sms') {
    return sendWhatsAppMessage(settings, payload.phone, body);
  }
  return {
    sent: false,
    provider: 'email-not-configured',
    channel: 'EMAIL',
    error: 'Canal email pendiente de proveedor SMTP',
    preview: body,
  };
}

export async function testStripeConnection(settings: IntegrationSettingsRecord): Promise<DeliveryResult> {
  if (!settings.stripeSecretKey) {
    return { sent: false, provider: 'stripe', channel: 'STRIPE', error: 'Secret key no configurada' };
  }
  const res = await fetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${settings.stripeSecretKey}` },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { sent: false, provider: 'stripe', channel: 'STRIPE', error: err || `HTTP ${res.status}` };
  }
  return { sent: true, provider: 'stripe-api', channel: 'STRIPE', preview: 'Balance consultado correctamente' };
}

export async function testTelegramConnection(settings: IntegrationSettingsRecord): Promise<DeliveryResult> {
  if (!settings.telegramBotToken) {
    return { sent: false, provider: 'telegram', channel: 'TELEGRAM', error: 'Bot token no configurado' };
  }
  const res = await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/getMe`);
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string }; description?: string };
  if (!data.ok) {
    return { sent: false, provider: 'telegram', channel: 'TELEGRAM', error: data.description || 'getMe falló' };
  }
  return {
    sent: true,
    provider: 'telegram-bot-api',
    channel: 'TELEGRAM',
    preview: `@${data.result?.username || settings.telegramBotUsername || 'bot'}`,
  };
}

export async function testOpenPayConnection(settings: IntegrationSettingsRecord): Promise<DeliveryResult> {
  if (!settings.openpayMerchantId.trim() || !settings.openpayPrivateKey.trim()) {
    return {
      sent: false,
      provider: 'openpay',
      channel: 'OPENPAY',
      error: 'Merchant ID y private key requeridos',
    };
  }
  const base = settings.openpaySandbox ? 'https://sandbox-api.openpay.mx' : 'https://api.openpay.mx';
  const auth = 'Basic ' + Buffer.from(`${settings.openpayPrivateKey.trim()}:`).toString('base64');
  const res = await fetch(
    `${base}/v1/${settings.openpayMerchantId.trim()}/charges?limit=1`,
    { headers: { Authorization: auth } },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return {
      sent: false,
      provider: 'openpay',
      channel: 'OPENPAY',
      error: err.slice(0, 300) || `HTTP ${res.status}`,
    };
  }
  return {
    sent: true,
    provider: 'openpay-api',
    channel: 'OPENPAY',
    preview: `Credenciales válidas (${settings.openpaySandbox ? 'sandbox' : 'producción'})`,
  };
}

export async function testWhatsAppConnection(settings: IntegrationSettingsRecord): Promise<DeliveryResult> {
  if (!settings.whatsappAccessToken || !settings.whatsappPhoneNumberId) {
    return { sent: false, provider: 'whatsapp', channel: 'WHATSAPP', error: 'Token o phone_number_id faltante' };
  }
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${settings.whatsappPhoneNumberId}`,
    { headers: { Authorization: `Bearer ${settings.whatsappAccessToken}` } },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { sent: false, provider: 'whatsapp', channel: 'WHATSAPP', error: err || `HTTP ${res.status}` };
  }
  return { sent: true, provider: 'whatsapp-cloud-api', channel: 'WHATSAPP', preview: 'Phone number ID válido' };
}
