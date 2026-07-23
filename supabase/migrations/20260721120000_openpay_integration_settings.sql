-- OpenPay (tarjeta + SPEI/CoDi) por WISP en wisp_integration_settings.
-- Los secretos (private key, webhook secret) se cifran en la app (AES-256-GCM),
-- igual que el resto de credenciales de esta tabla.
alter table public.wisp_integration_settings
  add column if not exists openpay_enabled boolean not null default false,
  add column if not exists openpay_merchant_id text,
  add column if not exists openpay_public_key text,
  add column if not exists openpay_private_key text,
  add column if not exists openpay_webhook_secret text,
  add column if not exists openpay_sandbox boolean not null default true;
