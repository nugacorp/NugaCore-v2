import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseIntegrationsRepository,
  emptyIntegrationSettings,
} from '../../backend/domains/integrations/repository';
import { decryptSecret } from '../../backend/services/crypto';

// Fake admin mínimo: captura la fila upserted y la devuelve tal cual en select.
// Reproduce las cadenas usadas por el repo:
//   save: from(t).upsert(row, opts).select('*').single()
//   get:  from(t).select('*').eq('id', id).maybeSingle()
const makeFakeAdmin = () => {
  const captured: {
    row: Record<string, unknown> | null;
    readError: { code: string; message: string } | null;
  } = { row: null, readError: null };
  const admin = {
    from() {
      return {
        upsert(row: Record<string, unknown>) {
          captured.row = row;
          return {
            select() {
              return { single: async () => ({ data: captured.row, error: null }) };
            },
          };
        },
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: captured.row, error: captured.readError }),
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, captured };
};

describe('SupabaseIntegrationsRepository — cifrado en reposo de credenciales', () => {
  it('la fila escrita en DB NUNCA contiene el secreto en texto plano', async () => {
    const { admin, captured } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    const rec = emptyIntegrationSettings();
    rec.stripeSecretKey = 'sk_live_SUPER_SECRETO';
    rec.whatsappAccessToken = 'EAAG_whatsapp_token';
    rec.telegramBotToken = '123456:ABC-telegram';
    rec.codiWebhookSecret = 'codi_webhook_hmac';
    rec.stripeWebhookSecret = 'whsec_stripe';
    rec.whatsappWebhookVerifyToken = 'verify_token';

    await repo.save(rec);
    const row = captured.row!;

    // El texto plano no aparece en ninguna columna cifrada.
    expect(String(row.stripe_secret_key)).not.toBe('sk_live_SUPER_SECRETO');
    expect(String(row.whatsapp_access_token)).not.toBe('EAAG_whatsapp_token');
    expect(String(row.telegram_bot_token)).not.toBe('123456:ABC-telegram');
    expect(String(row.codi_webhook_secret)).not.toBe('codi_webhook_hmac');

    // Y descifra de vuelta al original (formato iv.tag.ct).
    expect(decryptSecret(String(row.stripe_secret_key))).toBe('sk_live_SUPER_SECRETO');
    expect(decryptSecret(String(row.telegram_bot_token))).toBe('123456:ABC-telegram');
  });

  it('round-trip: get() devuelve el secreto descifrado al llamador', async () => {
    const { admin } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    const rec = emptyIntegrationSettings();
    rec.stripeSecretKey = 'sk_live_round_trip';
    await repo.save(rec);

    const read = await repo.get();
    expect(read.stripeSecretKey).toBe('sk_live_round_trip');
  });

  it('getPersisted() devuelve null sin fila y la fila real cuando existe', async () => {
    const { admin } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    expect(await repo.getPersisted('tenant-default')).toBeNull();

    const rec = emptyIntegrationSettings();
    rec.openpayEnabled = false;
    await repo.save(rec, 'tenant-default');

    const persisted = await repo.getPersisted('tenant-default');
    expect(persisted).not.toBeNull();
    expect(persisted?.openpayEnabled).toBe(false);
  });

  it('no confunde un error real de schema con ausencia de tabla/fila', async () => {
    const { admin, captured } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);
    captured.readError = { code: '42703', message: 'column openpay_enabled does not exist' };

    await expect(repo.getPersisted('tenant-default')).rejects.toMatchObject({ code: '42703' });
  });

  it('propaga 42P01: tabla ausente no equivale a fila ausente ni habilita fallback env', async () => {
    const { admin, captured } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);
    captured.readError = { code: '42P01', message: 'relation wisp_integration_settings does not exist' };

    await expect(repo.getPersisted('tenant-default')).rejects.toMatchObject({ code: '42P01' });
  });

  it('tolera valores legacy en texto plano (sin romper)', async () => {
    const { admin, captured } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    // Simula una fila escrita antes del cifrado (texto plano en DB). Legacy en
    // cuanto al cifrado, no en cuanto a tenancy: `tenant_id` ya es NOT NULL
    // tras la migración de canonicalización (ver integrations.tenant-canonical).
    captured.row = {
      id: 'default',
      tenant_id: 'tenant-default',
      stripe_secret_key: 'sk_live_LEGACY_PLANO',
    };

    const read = await repo.get();
    expect(read.stripeSecretKey).toBe('sk_live_LEGACY_PLANO');
  });

  it('los datos NO secretos (CLABE, merchant) quedan en texto plano', async () => {
    const { admin, captured } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    const rec = emptyIntegrationSettings();
    rec.codiClabe = '012345678901234567';
    rec.codiBeneficiaryName = 'WISP Ejemplo SA';
    await repo.save(rec);

    expect(String(captured.row!.codi_clabe)).toBe('012345678901234567');
    expect(String(captured.row!.codi_beneficiary_name)).toBe('WISP Ejemplo SA');
  });
});
