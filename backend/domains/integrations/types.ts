export type IntegrationProviderKey = 'stripe' | 'whatsapp' | 'telegram' | 'codi' | 'openpay';

export interface IntegrationSettingsRecord {
  id: string;
  stripeEnabled: boolean;
  stripePublishableKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  whatsappEnabled: boolean;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  whatsappBusinessAccountId: string;
  whatsappWebhookVerifyToken: string;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramBotUsername: string;
  codiEnabled: boolean;
  codiMerchantId: string;
  codiBeneficiaryName: string;
  codiClabe: string;
  codiWebhookSecret: string;
  codiCertificateRef: string;
  openpayEnabled: boolean;
  openpayMerchantId: string;
  openpayPublicKey: string;
  openpayPrivateKey: string;
  openpayWebhookSecret: string;
  openpaySandbox: boolean;
  /** Token opaco por WISP para la URL de webhook de OpenPay. No es secreto. */
  openpayWebhookToken: string;
  updatedAt: string;
}

export interface IntegrationSettingsPatch {
  stripe?: {
    enabled?: boolean;
    publishableKey?: string;
    secretKey?: string;
    webhookSecret?: string;
  };
  whatsapp?: {
    enabled?: boolean;
    phoneNumberId?: string;
    accessToken?: string;
    businessAccountId?: string;
    webhookVerifyToken?: string;
  };
  telegram?: {
    enabled?: boolean;
    botToken?: string;
    botUsername?: string;
  };
  codi?: {
    enabled?: boolean;
    merchantId?: string;
    beneficiaryName?: string;
    clabe?: string;
    webhookSecret?: string;
    certificateRef?: string;
  };
  openpay?: {
    enabled?: boolean;
    merchantId?: string;
    publicKey?: string;
    privateKey?: string;
    webhookSecret?: string;
    sandbox?: boolean;
  };
}

export interface DeliveryResult {
  sent: boolean;
  provider: string;
  channel: string;
  messageId?: string;
  error?: string;
  preview?: string;
}

export interface InvoiceNotifyPayload {
  clientId: string;
  clientName: string;
  phone: string;
  telegramChatId?: string;
  channel: 'whatsapp' | 'telegram' | 'sms' | 'email';
  invoiceId: string;
  amount: number;
  dueDate: string;
  paymentReference: string;
  billingCycleLabel?: string;
}
