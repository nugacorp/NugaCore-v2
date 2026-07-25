// ====================================================================
// Integraciones por tenant — cada WISP tiene sus propias credenciales,
// sin mezclar. tenant-default mapea a la fila legacy 'default'.
// ====================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../backend/state/store';
import { StoreIntegrationsRepository } from '../../backend/domains/integrations/repository';
import { IntegrationsService } from '../../backend/domains/integrations/service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

describe('Integraciones multi-tenant (aislamiento de credenciales)', () => {
  let repo: StoreIntegrationsRepository;
  let svc: IntegrationsService;

  beforeEach(() => {
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    repo = new StoreIntegrationsRepository();
    svc = new IntegrationsService(repo);
  });

  afterEach(() => {
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
  });

  it('guarda credenciales OpenPay por WISP y no las mezcla entre tenants', async () => {
    await svc.updateSettings(
      { openpay: { enabled: true, merchantId: 'MERCHANT_A', privateKey: 'sk_a', sandbox: true } },
      TENANT_A,
    );

    const a = await svc.getSettingsRaw(TENANT_A);
    expect(a.openpayMerchantId).toBe('MERCHANT_A');
    expect(a.openpayPrivateKey).toBe('sk_a');

    // WISP B nunca ve las credenciales de A.
    const b = await svc.getSettingsRaw(TENANT_B);
    expect(b.openpayMerchantId).toBe('');
    expect(b.openpayPrivateKey).toBe('');
    expect(b.openpayEnabled).toBe(false);
  });

  it('genera un token de webhook opaco por WISP al habilitar OpenPay', async () => {
    await svc.updateSettings({ openpay: { enabled: true, merchantId: 'M', privateKey: 'k' } }, TENANT_A);
    const a = await svc.getSettingsRaw(TENANT_A);
    expect(a.openpayWebhookToken).toMatch(/^[a-f0-9]{32,}$/);

    // El token de A no aparece en B.
    const b = await svc.getSettingsRaw(TENANT_B);
    expect(b.openpayWebhookToken).toBe('');
  });

  it('tenant-default mapea a la fila legacy "default"', async () => {
    await svc.updateSettings({ openpay: { enabled: true, merchantId: 'LEGACY', privateKey: 'k' } }, 'tenant-default');
    // Sin tenant explícito también resuelve a 'default'.
    const legacy = await svc.getSettingsRaw();
    expect(legacy.openpayMerchantId).toBe('LEGACY');
    expect(legacy.id).toBe('default');
  });
});
