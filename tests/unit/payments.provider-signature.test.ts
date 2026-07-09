import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

// ====================================================================
// C-01 (hardening) — robustez de la verificación de firma en los
// proveedores reales (mercado_pago / openpay). Una firma malformada
// (longitud distinta) NO debe lanzar (RangeError de timingSafeEqual) y
// convertirse en un 500: debe devolver { valid: false } limpio.
//
// SIMULATED se calcula al cargar el módulo a partir de las credenciales,
// así que fijamos el entorno y reimportamos con módulos frescos para forzar
// el modo NO simulado (donde corre la verificación real de firma).
// ====================================================================

const body = JSON.stringify({ id: 'evt-1', status: 'approved' });
const sign = (secret: string, payload: string) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

describe('Verificación de firma en proveedores reales (no-simulado)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('MP_ACCESS_TOKEN', 'test-token');
    vi.stubEnv('OPENPAY_MERCHANT_ID', 'test-merchant');
    vi.stubEnv('OPENPAY_PRIVATE_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('mercado_pago: firma de longitud distinta -> invalid (no lanza)', async () => {
    const { MercadoPagoProvider } = await import(
      '../../backend/domains/payments/providers/mercadopago.provider'
    );
    const p = new MercadoPagoProvider();
    expect(() => p.verifyWebhook(body, 'deadbeef', 's3cret')).not.toThrow();
    expect(p.verifyWebhook(body, 'deadbeef', 's3cret').valid).toBe(false);
    expect(p.verifyWebhook(body, sign('s3cret', body), 's3cret').valid).toBe(true);
  });

  it('openpay: firma de longitud distinta -> invalid (no lanza)', async () => {
    const { OpenPayProvider } = await import(
      '../../backend/domains/payments/providers/openpay.provider'
    );
    const p = new OpenPayProvider();
    expect(() => p.verifyWebhook(body, 'deadbeef', 's3cret')).not.toThrow();
    expect(p.verifyWebhook(body, 'deadbeef', 's3cret').valid).toBe(false);
    expect(p.verifyWebhook(body, sign('s3cret', body), 's3cret').valid).toBe(true);
  });
});
