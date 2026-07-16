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

-- RLS — wisp_integration_settings guarda credenciales en claro (Stripe/WhatsApp/
-- Telegram/CoDi). Sin RLS, PostgREST la expone y los default privileges de public
-- dan a anon todos los privilegios sobre ella. Deny-by-default como el resto del
-- proyecto (ver 20260713180000 / 20260713190000): backend usa service_role.
ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'wisp_integration_settings'
      AND policyname = 'wisp_integration_settings_service_role'
  ) THEN
    EXECUTE
      'CREATE POLICY wisp_integration_settings_service_role '
      || 'ON public.wisp_integration_settings '
      || 'FOR ALL '
      || 'USING (auth.role() = ''service_role'') '
      || 'WITH CHECK (auth.role() = ''service_role'');';
  END IF;
END $$;
