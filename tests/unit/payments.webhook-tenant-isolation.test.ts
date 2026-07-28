// ====================================================================
// T3 — Aislamiento por WISP en el borde del webhook:
//   - resolución token opaco → tenant (sin fallback cruzado ni a 'default');
//   - idempotencia de payment_events acotada al tenant;
//   - búsqueda de order por providerOrderId acotada al tenant.
// ====================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  StoreIntegrationsRepository,
  emptyIntegrationSettings,
} from '../../backend/domains/integrations/repository';
import { IntegrationsService } from '../../backend/domains/integrations/service';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import type { PaymentEventRecord, PaymentOrderRecord } from '../../backend/domains/payments/types';
import { store } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const reset = () => {
  store.INTEGRATION_SETTINGS = emptyIntegrationSettings();
  store.INTEGRATION_SETTINGS_BY_TENANT = {};
  store.PAYMENT_EVENTS.length = 0;
  store.PAYMENT_ORDERS.length = 0;
};

beforeEach(reset);
afterEach(reset);

describe('Resolución del token de webhook OpenPay → WISP', () => {
  const buildService = () => new IntegrationsService(new StoreIntegrationsRepository());

  it('resuelve el WISP dueño del token y nunca otro', async () => {
    const svc = buildService();
    await svc.updateSettings({ openpay: { enabled: true, merchantId: 'M_A', privateKey: 'k_a' } }, TENANT_A);
    await svc.updateSettings({ openpay: { enabled: true, merchantId: 'M_B', privateKey: 'k_b' } }, TENANT_B);

    const tokenA = (await svc.getSettingsRaw(TENANT_A)).openpayWebhookToken;
    const tokenB = (await svc.getSettingsRaw(TENANT_B)).openpayWebhookToken;
    expect(tokenA).not.toBe(tokenB);

    expect((await svc.resolveOpenPayWebhookTenant(tokenA))?.tenantId).toBe(TENANT_A);
    expect((await svc.resolveOpenPayWebhookTenant(tokenB))?.tenantId).toBe(TENANT_B);
  });

  it('la fila legacy "default" resuelve al tenant por defecto', async () => {
    const svc = buildService();
    await svc.updateSettings({ openpay: { enabled: true, merchantId: 'M', privateKey: 'k' } }, 'tenant-default');
    const token = (await svc.getSettingsRaw('tenant-default')).openpayWebhookToken;

    expect((await svc.resolveOpenPayWebhookTenant(token))?.tenantId).toBe('tenant-default');
  });

  it('token desconocido o vacío → null (nunca cae a "default")', async () => {
    const svc = buildService();
    await svc.updateSettings({ openpay: { enabled: true, merchantId: 'M', privateKey: 'k' } }, 'tenant-default');

    expect(await svc.resolveOpenPayWebhookTenant('no-existe')).toBeNull();
    expect(await svc.resolveOpenPayWebhookTenant('')).toBeNull();
    expect(await svc.resolveOpenPayWebhookTenant('   ')).toBeNull();
  });

  it('un WISP sin OpenPay habilitado no tiene token con el que ser resuelto', async () => {
    const svc = buildService();
    await svc.updateSettings({ openpay: { enabled: false, merchantId: 'M', privateKey: 'k' } }, TENANT_A);

    expect((await svc.getSettingsRaw(TENANT_A)).openpayWebhookToken).toBe('');
    expect(await svc.resolveOpenPayWebhookTenant('')).toBeNull();
  });
});

describe('Idempotencia de payment_events acotada al WISP', () => {
  const repo = new StorePaymentRepository();

  const seedEvent = async (tenantId: string, providerEventId: string): Promise<PaymentEventRecord> =>
    repo.createEvent({
      id: `pe-${tenantId}-${providerEventId}`,
      tenantId,
      provider: 'openpay',
      providerEventId,
      eventType: 'charge.succeeded',
      processed: true,
      payload: {},
      receivedAt: new Date().toISOString(),
    });

  it('el evento de A no se ve como duplicado desde B', async () => {
    await seedEvent(TENANT_A, 'evt-1');

    expect(await repo.findEventByProviderId('openpay', 'evt-1', TENANT_A)).not.toBeNull();
    expect(await repo.findEventByProviderId('openpay', 'evt-1', TENANT_B)).toBeNull();
  });

  it('sin tenant (compatibilidad) el lookup sigue siendo global', async () => {
    await seedEvent(TENANT_A, 'evt-2');
    expect(await repo.findEventByProviderId('openpay', 'evt-2')).not.toBeNull();
  });

  it('los eventos legacy sin stamp cuentan como del tenant por defecto', async () => {
    store.PAYMENT_EVENTS.push({
      id: 'pe-legacy',
      provider: 'openpay',
      providerEventId: 'evt-legacy',
      eventType: 'charge.succeeded',
      processed: true,
      payload: {},
      receivedAt: new Date().toISOString(),
    } as PaymentEventRecord);

    expect(await repo.findEventByProviderId('openpay', 'evt-legacy', 'tenant-default')).not.toBeNull();
    expect(await repo.findEventByProviderId('openpay', 'evt-legacy', TENANT_B)).toBeNull();
  });
});

describe('Búsqueda de order por providerOrderId acotada al WISP', () => {
  const repo = new StorePaymentRepository();

  it('el providerOrderId de un WISP no alcanza la order de otro', async () => {
    const base: Omit<PaymentOrderRecord, 'id' | 'tenantId'> = {
      customerId: 'c-1',
      invoiceId: 'fac-1',
      provider: 'openpay',
      providerOrderId: 'chg-shared',
      amountCents: 1000,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.createOrder({ ...base, id: 'po-b', tenantId: TENANT_B });

    expect(await repo.findOrderByProviderOrderId('openpay', 'chg-shared', TENANT_B)).not.toBeNull();
    expect(await repo.findOrderByProviderOrderId('openpay', 'chg-shared', TENANT_A)).toBeNull();
  });
});
