// ====================================================================
// T2 — El provider OpenPay resuelve sus credenciales de la fila de
// integraciones del WISP activo, no de process.env.
//
// Invariantes cubiertas:
//   - Aislamiento: las credenciales de un WISP nunca se usan para otro.
//   - env es fallback SOLO del tenant por defecto (single-WISP).
//   - Sin credenciales utilizables → modo simulado (fail-closed, sin red).
//   - Ningún secreto viaja en la respuesta de la order.
// ====================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../backend/state/store';
import {
  getIntegrationsService,
  resetIntegrationsService,
} from '../../backend/domains/integrations/service';
import {
  isUsableOpenPayConfig,
  resolveOpenPayConfig,
} from '../../backend/domains/payments/providers/openpay-config';
import { OpenPayProvider } from '../../backend/domains/payments/providers/openpay.provider';
import { resolveProvider } from '../../backend/domains/payments/providers/index';
import { getPaymentService, resetPaymentService } from '../../backend/domains/payments/service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const req = {
  orderId: 'ord-1',
  invoiceId: 'fac-101',
  customerId: 'c-1',
  amountCents: 29900,
};

const okFetch = (payload: Record<string, unknown>) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch;

const fetchCalls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;

const seedOpenPay = async (
  tenantId: string,
  patch: { merchantId: string; privateKey: string; sandbox?: boolean; webhookSecret?: string; enabled?: boolean },
) => {
  await getIntegrationsService().updateSettings(
    {
      openpay: {
        enabled: patch.enabled ?? true,
        merchantId: patch.merchantId,
        privateKey: patch.privateKey,
        sandbox: patch.sandbox ?? true,
        webhookSecret: patch.webhookSecret,
      },
    },
    tenantId,
  );
};

describe('OpenPay — resolución de configuración por tenant', () => {
  beforeEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    resetIntegrationsService();
    resetPaymentService();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    resetIntegrationsService();
    resetPaymentService();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('usa las credenciales del WISP activo, no las de env', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a', sandbox: false });

    const cfg = await resolveOpenPayConfig(TENANT_A);
    expect(cfg.merchantId).toBe('MERCHANT_A');
    expect(cfg.privateKey).toBe('sk_a');
    expect(cfg.sandbox).toBe(false);
  });

  it('no filtra credenciales de un WISP a otro (sin fallback a env ni cruzado)', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a' });

    const cfg = await resolveOpenPayConfig(TENANT_B);
    expect(cfg.merchantId).toBe('');
    expect(cfg.privateKey).toBe('');
  });

  it('tenant-default cae a env cuando su fila no tiene credenciales (single-WISP)', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');

    const cfg = await resolveOpenPayConfig('tenant-default');
    expect(cfg.merchantId).toBe('ENV_MERCHANT');
    expect(cfg.privateKey).toBe('sk_env');

    // Sin tenant explícito el comportamiento es el mismo.
    const implicit = await resolveOpenPayConfig();
    expect(implicit.merchantId).toBe('ENV_MERCHANT');
  });

  it('tenant-default prefiere su fila sobre env', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    await seedOpenPay('tenant-default', { merchantId: 'ROW_MERCHANT', privateKey: 'sk_row' });

    const cfg = await resolveOpenPayConfig('tenant-default');
    expect(cfg.merchantId).toBe('ROW_MERCHANT');
    expect(cfg.privateKey).toBe('sk_row');
  });

  it('OpenPay deshabilitado en el WISP → sin credenciales utilizables', async () => {
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a', enabled: false });

    const cfg = await resolveOpenPayConfig(TENANT_A);
    expect(cfg.merchantId).toBe('');
    expect(cfg.privateKey).toBe('');
  });

  // El toggle de la UI manda sobre el entorno. `env` es la compatibilidad de
  // una instalación legacy que nunca guardó settings; en cuanto el WISP tiene
  // fila propia, apagar OpenPay en la UI tiene que apagarlo de verdad.
  it('tenant-default con fila guardada y OpenPay apagado ignora env', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    await seedOpenPay('tenant-default', {
      merchantId: 'ROW_MERCHANT',
      privateKey: 'sk_row',
      enabled: false,
    });

    const cfg = await resolveOpenPayConfig('tenant-default');
    expect(cfg.merchantId).toBe('');
    expect(cfg.privateKey).toBe('');
    expect(isUsableOpenPayConfig(cfg)).toBe(false);
  });

  it('tenant-default con fila guardada sin credenciales tampoco cae a env', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    // Fila persistida y habilitada, pero incompleta: la decisión ya es del WISP.
    await seedOpenPay('tenant-default', { merchantId: '', privateKey: '' });

    const cfg = await resolveOpenPayConfig('tenant-default');
    expect(cfg.merchantId).toBe('');
    expect(isUsableOpenPayConfig(cfg)).toBe(false);
  });

  it('sin fila persistida, el tenant por defecto sí usa env (instalación legacy)', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');

    const cfg = await resolveOpenPayConfig('tenant-default');
    expect(cfg.merchantId).toBe('ENV_MERCHANT');
    expect(isUsableOpenPayConfig(cfg)).toBe(true);
  });

  it('la fila habilitada y utilizable gana sobre env', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    await seedOpenPay('tenant-default', { merchantId: 'ROW_MERCHANT', privateKey: 'sk_row' });

    const cfg = await resolveOpenPayConfig('tenant-default');
    expect(cfg.merchantId).toBe('ROW_MERCHANT');
    expect(cfg.privateKey).toBe('sk_row');
  });

  it('expone el webhook secret del WISP (para verificación por tenant)', async () => {
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a', webhookSecret: 'whsec_a' });

    const cfg = await resolveOpenPayConfig(TENANT_A);
    expect(cfg.webhookSecret).toBe('whsec_a');
  });
});

describe('OpenPayProvider con configuración inyectada', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cobra con el merchant/private key del tenant contra el host de su modo sandbox', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'chg-1', payment_method: { url: 'https://pay/x' } }));
    const p = new OpenPayProvider('openpay', 'card', {
      merchantId: 'MERCHANT_A',
      privateKey: 'sk_a',
      sandbox: true,
    });

    const res = await p.createPaymentOrder(req);
    expect(res.providerOrderId).toBe('chg-1');
    const [url, init] = fetchCalls()[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://sandbox-api.openpay.mx/v1/MERCHANT_A/charges');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('sk_a:').toString('base64')}`);
  });

  it('sandbox=false del tenant apunta al host de producción', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'chg-2' }));
    const p = new OpenPayProvider('openpay', 'card', {
      merchantId: 'MERCHANT_B',
      privateKey: 'sk_b',
      sandbox: false,
    });

    await p.createPaymentOrder(req);
    const [url] = fetchCalls()[0] as [string];
    expect(url).toBe('https://api.openpay.mx/v1/MERCHANT_B/charges');
  });

  it('sin credenciales del tenant → simulado y sin llamadas de red (fail-closed)', async () => {
    vi.stubGlobal('fetch', okFetch({ id: 'no-debe-llamarse' }));
    const p = new OpenPayProvider('openpay', 'card', { merchantId: '', privateKey: '', sandbox: true });

    const res = await p.createPaymentOrder(req);
    expect(res.providerOrderId).toContain('op-sim');
    expect(fetchCalls()).toHaveLength(0);

    const status = await p.getPaymentStatus('op-sim-ord-1');
    expect(status.status).toBe('pending');
    expect(fetchCalls()).toHaveLength(0);
  });

  it('verifyWebhook usa el secreto del tenant cuando la ruta no aporta uno', async () => {
    const { createHmac } = await import('crypto');
    const body = JSON.stringify({ id: 'evt-1', status: 'completed' });
    const p = new OpenPayProvider('openpay', 'card', {
      merchantId: 'MERCHANT_A',
      privateKey: 'sk_a',
      sandbox: true,
      webhookSecret: 'whsec_a',
    });

    const good = createHmac('sha256', 'whsec_a').update(body).digest('hex');
    expect(p.verifyWebhook(body, good, '').valid).toBe(true);
    const other = createHmac('sha256', 'whsec_b').update(body).digest('hex');
    expect(p.verifyWebhook(body, other, '').valid).toBe(false);
  });

  it('no incluye credenciales en el payload simulado devuelto al cliente', async () => {
    const p = new OpenPayProvider('spei', 'bank_account', {
      merchantId: '',
      privateKey: 'sk_no_usable',
      sandbox: true,
      webhookSecret: 'whsec_a',
    });
    const res = await p.createPaymentOrder(req);
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('sk_no_usable');
    expect(serialized).not.toContain('whsec_a');
  });
});

describe('Factoría de providers por tenant', () => {
  beforeEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    resetIntegrationsService();
    resetPaymentService();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    resetIntegrationsService();
    resetPaymentService();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('resolveProvider("openpay", tenant) construye el provider con las creds del WISP', async () => {
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a' });
    vi.stubGlobal('fetch', okFetch({ id: 'chg-a' }));

    const p = await resolveProvider('openpay', TENANT_A);
    expect(p.name).toBe('openpay');
    await p.createPaymentOrder(req);
    const [url] = fetchCalls()[0] as [string];
    expect(url).toContain('/v1/MERCHANT_A/charges');
  });

  it('resolveProvider("spei", tenant) conserva el modo bank_account', async () => {
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a' });
    vi.stubGlobal('fetch', okFetch({ id: 'chg-spei', payment_method: { clabe: '646180111812345678' } }));

    const p = await resolveProvider('spei', TENANT_A);
    expect(p.name).toBe('spei');
    await p.createPaymentOrder(req);
    const [, init] = fetchCalls()[0] as [string, { body: string }];
    expect(JSON.parse(init.body).method).toBe('bank_account');
  });

  it('un WISP sin credenciales queda en simulado aunque otro WISP sí las tenga', async () => {
    await seedOpenPay(TENANT_A, { merchantId: 'MERCHANT_A', privateKey: 'sk_a' });
    vi.stubGlobal('fetch', okFetch({ id: 'no-debe-llamarse' }));

    const p = await resolveProvider('openpay', TENANT_B);
    const res = await p.createPaymentOrder(req);
    expect(res.providerOrderId).toContain('op-sim');
    expect(fetchCalls()).toHaveLength(0);
  });

  it('los providers ajenos a OpenPay no cambian', async () => {
    const manual = await resolveProvider('manual', TENANT_A);
    expect(manual.name).toBe('manual');
    const codi = await resolveProvider('codi', TENANT_A);
    expect(codi.name).toBe('codi');
  });
});

describe('PaymentService.createOrder propaga el tenant al provider', () => {
  beforeEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    store.PAYMENT_ORDERS.length = 0;
    resetIntegrationsService();
    resetPaymentService();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    store.PAYMENT_ORDERS.length = 0;
    resetIntegrationsService();
    resetPaymentService();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('la order del tenant por defecto usa el merchant de su fila, no el de env', async () => {
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'ENV_MERCHANT');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'sk_env');
    await seedOpenPay('tenant-default', { merchantId: 'ROW_MERCHANT', privateKey: 'sk_row' });
    vi.stubGlobal('fetch', okFetch({ id: 'chg-row', payment_method: { url: 'https://pay/row' } }));

    const view = await getPaymentService().createOrder({
      customerId: 'c-1',
      invoiceId: 'fac-101',
      provider: 'openpay',
      amountCents: 29900,
      tenantId: 'tenant-default',
    });

    const [url] = fetchCalls()[0] as [string];
    expect(url).toContain('/v1/ROW_MERCHANT/charges');
    expect(url).not.toContain('ENV_MERCHANT');
    expect(JSON.stringify(view)).not.toContain('sk_row');
  });
});
