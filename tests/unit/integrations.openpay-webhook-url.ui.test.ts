// ====================================================================
// T4 — URL única de webhook OpenPay por WISP en Sistema → Integraciones.
//
// La URL SIEMPRE se deriva del `webhookPath` que entrega el backend
// (token opaco por tenant). El cliente nunca fabrica el token ni la ruta.
// ====================================================================

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIntegrationView } from '../../backend/domains/integrations/delivery';
import { emptyIntegrationSettings } from '../../backend/domains/integrations/repository';
import { openpayWebhookView } from '../../src/lib/integrationsView';

const TOKEN = 'a'.repeat(32);

describe('openpayWebhookView — URL derivada del backend', () => {
  it('arma la URL absoluta con el origin actual y el webhookPath del WISP', () => {
    const view = openpayWebhookView({
      origin: 'https://wisp-a.nugacore.mx',
      webhookPath: `/api/payments/webhook/openpay/${TOKEN}`,
      enabled: true,
    });
    expect(view.available).toBe(true);
    expect(view.url).toBe(`https://wisp-a.nugacore.mx/api/payments/webhook/openpay/${TOKEN}`);
  });

  it('normaliza origin con slash final, path o query previos', () => {
    const expected = `https://wisp-a.nugacore.mx/api/payments/webhook/openpay/${TOKEN}`;
    const path = `/api/payments/webhook/openpay/${TOKEN}`;
    expect(openpayWebhookView({ origin: 'https://wisp-a.nugacore.mx/', webhookPath: path, enabled: true }).url).toBe(
      expected,
    );
    expect(
      openpayWebhookView({ origin: 'https://wisp-a.nugacore.mx/sistema?tab=openpay', webhookPath: path, enabled: true })
        .url,
    ).toBe(expected);
  });

  it('sin webhookPath no hay URL y orienta a guardar OpenPay (no fabrica token)', () => {
    const view = openpayWebhookView({
      origin: 'https://wisp-a.nugacore.mx',
      webhookPath: '',
      enabled: true,
    });
    expect(view.available).toBe(false);
    expect(view.url).toBe('');
    expect(view.hint).toMatch(/guarda/i);
    expect(view.hint).not.toMatch(/webhook\/openpay\//);
  });

  it('con OpenPay deshabilitado orienta a habilitarlo primero', () => {
    const view = openpayWebhookView({
      origin: 'https://wisp-a.nugacore.mx',
      webhookPath: '',
      enabled: false,
    });
    expect(view.available).toBe(false);
    expect(view.url).toBe('');
    expect(view.hint).toMatch(/habilita/i);
  });

  it('sin origin (render fuera del navegador) no inventa una URL', () => {
    const view = openpayWebhookView({
      origin: '',
      webhookPath: `/api/payments/webhook/openpay/${TOKEN}`,
      enabled: true,
    });
    expect(view.available).toBe(false);
    expect(view.url).toBe('');
  });

  it('cada WISP obtiene su propia URL a partir de su path', () => {
    const tokenB = 'b'.repeat(32);
    const a = openpayWebhookView({
      origin: 'https://app.nugacore.mx',
      webhookPath: `/api/payments/webhook/openpay/${TOKEN}`,
      enabled: true,
    });
    const b = openpayWebhookView({
      origin: 'https://app.nugacore.mx',
      webhookPath: `/api/payments/webhook/openpay/${tokenB}`,
      enabled: true,
    });
    expect(a.url).not.toBe(b.url);
    expect(a.url).toContain(TOKEN);
    expect(b.url).toContain(tokenB);
  });
});

describe('contrato backend → UI de la URL de webhook', () => {
  it('el webhookPath de la vista alimenta la URL mostrada', () => {
    const rec = { ...emptyIntegrationSettings(), openpayEnabled: true, openpayWebhookToken: TOKEN };
    const view = buildIntegrationView(rec);
    expect(view.openpay.webhookPath).toBe(`/api/payments/webhook/openpay/${TOKEN}`);

    const shown = openpayWebhookView({
      origin: 'https://app.nugacore.mx',
      webhookPath: view.openpay.webhookPath,
      enabled: view.openpay.enabled,
    });
    expect(shown.url).toBe(`https://app.nugacore.mx/api/payments/webhook/openpay/${TOKEN}`);
  });

  it('sin token el backend no entrega path y la UI no muestra URL', () => {
    const view = buildIntegrationView(emptyIntegrationSettings());
    expect(view.openpay.webhookPath).toBe('');
    expect(
      openpayWebhookView({
        origin: 'https://app.nugacore.mx',
        webhookPath: view.openpay.webhookPath,
        enabled: view.openpay.enabled,
      }).available,
    ).toBe(false);
  });

  it('la vista nunca expone privateKey ni webhookSecret en claro', () => {
    const rec = {
      ...emptyIntegrationSettings(),
      openpayEnabled: true,
      openpayPrivateKey: 'sk_super_secreto',
      openpayWebhookSecret: 'whsec_super_secreto',
      openpayWebhookToken: TOKEN,
    };
    const view = buildIntegrationView(rec);
    expect(JSON.stringify(view)).not.toContain('sk_super_secreto');
    expect(JSON.stringify(view)).not.toContain('whsec_super_secreto');
    expect(view.openpay.privateKeySet).toBe(true);
    expect(view.openpay.webhookSecretSet).toBe(true);
  });
});

describe('ExternalIntegrationsPanel — bloque de webhook OpenPay', () => {
  const panel = readFileSync('src/components/owner/ExternalIntegrationsPanel.tsx', 'utf8');

  it('muestra la URL en un campo readonly con acción de copiar', () => {
    expect(panel).toContain('openpay-webhook-url');
    expect(panel).toContain('copy-openpay-webhook');
    expect(panel).toContain('readOnly');
  });

  it('da feedback accesible al copiar', () => {
    expect(panel).toContain('aria-live');
    expect(panel).toContain('role="status"');
  });

  it('explica que la URL se registra en el panel de OpenPay', () => {
    const ready = openpayWebhookView({
      origin: 'https://app.nugacore.mx',
      webhookPath: `/api/payments/webhook/openpay/${TOKEN}`,
      enabled: true,
    });
    expect(ready.hint).toMatch(/panel de OpenPay/i);
    expect(panel).toContain('webhook.hint');
  });

  it('deriva la URL del backend: no arma la ruta ni usa el token suelto', () => {
    expect(panel).toContain('openpayWebhookView');
    expect(panel).toContain('webhookPath');
    expect(panel).not.toContain('/api/payments/webhook/openpay');
    expect(panel).not.toContain('webhookToken');
  });

  it('no lee window durante el render sin guardarse de entornos sin DOM', () => {
    expect(panel).toContain("typeof window === 'undefined'");
  });
});
