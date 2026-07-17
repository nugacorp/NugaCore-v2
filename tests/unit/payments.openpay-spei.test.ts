import { describe, expect, it } from 'vitest';
import { OpenPayProvider } from '../../backend/domains/payments/providers/openpay.provider';
import { getProvider } from '../../backend/domains/payments/providers/index';

// Sin OPENPAY_MERCHANT_ID/PRIVATE_KEY en el entorno de test → modo simulado
// (no llama a la red). Verifica la ESTRUCTURA de la vía SPEI/CoDi, no la API real.

const req = {
  orderId: 'ord-1',
  invoiceId: 'fac-101',
  customerId: 'c-1',
  amountCents: 29900,
};

describe('OpenPayProvider — vía SPEI/CoDi (bank_account)', () => {
  it('createPaymentOrder SPEI devuelve referencia + CLABE (simulado)', async () => {
    const p = new OpenPayProvider('spei', 'bank_account');
    const res = await p.createPaymentOrder(req);
    expect(res.providerOrderId).toContain('op-spei-sim');
    expect(res.rawPayload?.method).toBe('bank_account');
    expect(res.rawPayload?.reference).toBe('FAC-101-C-1');
    expect(String(res.rawPayload?.clabe)).toMatch(/^\d{18}$/);
    // SPEI no usa checkoutUrl (el cliente transfiere a la CLABE).
    expect(res.checkoutUrl).toBeUndefined();
  });

  it('el slot "spei" del factory usa OpenPay en modo SPEI', () => {
    const p = getProvider('spei');
    expect(p.name).toBe('spei');
  });

  it('modo card sigue intacto (checkoutUrl presente)', async () => {
    const p = new OpenPayProvider();
    const res = await p.createPaymentOrder(req);
    expect(res.providerOrderId).toContain('op-sim');
    expect(res.checkoutUrl).toBeTruthy();
    expect(res.rawPayload?.method).toBe('card');
  });

  it('getPaymentStatus SPEI simulado → pending', async () => {
    const p = new OpenPayProvider('spei', 'bank_account');
    const status = await p.getPaymentStatus('op-spei-sim-ord-1');
    expect(status.status).toBe('pending');
  });
});
