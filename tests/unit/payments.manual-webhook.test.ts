import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { ManualProvider } from '../../backend/domains/payments/providers/manual.provider';

// ====================================================================
// C-01 — Webhook de pago manual: verificación de firma.
//
// Propiedad de seguridad: cuando hay un secreto configurado
// (WEBHOOK_SECRET_MANUAL), el proveedor manual EXIGE una firma HMAC-SHA256
// válida, igual que mercado_pago/openpay. Sin secreto conserva el
// comportamiento legacy (el fail-closed del runtime endurecido se prueba a
// nivel de ruta). Ver backend/domains/payments/routes.ts.
// ====================================================================

const provider = new ManualProvider();
const body = JSON.stringify({ type: 'payment.approved', order_id: 'manual-po-1' });
const sign = (secret: string, payload: string) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

describe('ManualProvider.verifyWebhook', () => {
  it('sin secreto configurado: válido (comportamiento legacy)', () => {
    expect(provider.verifyWebhook(body, '', '')).toEqual({ valid: true });
  });

  it('con secreto + firma HMAC correcta: válido', () => {
    const secret = 's3cr3t-manual';
    const res = provider.verifyWebhook(body, sign(secret, body), secret);
    expect(res).toEqual({ valid: true });
  });

  it('con secreto pero SIN firma: inválido', () => {
    const res = provider.verifyWebhook(body, '', 's3cr3t-manual');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('missing_signature');
  });

  it('con secreto + firma incorrecta: inválido', () => {
    const res = provider.verifyWebhook(body, sign('otro-secreto', body), 's3cr3t-manual');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('signature_mismatch');
  });

  it('firma de longitud distinta no rompe (no lanza timingSafeEqual)', () => {
    const res = provider.verifyWebhook(body, 'deadbeef', 's3cr3t-manual');
    expect(res.valid).toBe(false);
    expect(res.reason).toBe('signature_mismatch');
  });
});
