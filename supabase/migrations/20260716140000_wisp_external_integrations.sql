-- Integraciones externas por WISP + preferencias de notificación del cliente.

CREATE TABLE IF NOT EXISTS public.wisp_integration_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  stripe_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_publishable_key TEXT,
  stripe_secret_key TEXT,
  stripe_webhook_secret TEXT,
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  whatsapp_phone_number_id TEXT,
  whatsapp_access_token TEXT,
  whatsapp_business_account_id TEXT,
  whatsapp_webhook_verify_token TEXT,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_bot_token TEXT,
  telegram_bot_username TEXT,
  codi_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  codi_merchant_id TEXT,
  codi_beneficiary_name TEXT,
  codi_clabe TEXT,
  codi_webhook_secret TEXT,
  codi_certificate_ref TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS notification_channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (notification_channel IN ('whatsapp', 'telegram', 'sms', 'email')),
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_zone_id TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_notification_channel
  ON public.clients (notification_channel);
