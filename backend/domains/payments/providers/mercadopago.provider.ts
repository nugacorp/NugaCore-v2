// ====================================================================
// Provider MercadoPago (Fase 4.8).
// Implementación de referencia. En producción se configuraría con
// MP_ACCESS_TOKEN. Por ahora opera en modo simulado para no requerir
// credenciales reales en tests herméticos.
// Firma de webhook: X-Signature header con HMAC-SHA256.
// ====================================================================

import crypto from 'crypto';
import { PaymentProvider } from '../types';
import {
  IPaymentProvider,
  PaymentOrderRequest,
  PaymentOrderResponse,
  ProviderPaymentStatus,
  WebhookVerifyResult,
} from './index';

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || '';
const SIMULATED = !MP_ACCESS_TOKEN;

export class MercadoPagoProvider implements IPaymentProvider {
  readonly name: PaymentProvider = 'mercado_pago';

  async createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    if (SIMULATED) {
      return {
        providerOrderId: `mp-sim-${req.orderId}`,
        checkoutUrl: `https://mp.sim/checkout/${req.orderId}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        rawPayload: { simulated: true, provider: 'mercado_pago', orderId: req.orderId },
      };
    }
    // Producción: llamada real a la API de MercadoPago
    const body = {
      external_reference: req.orderId,
      items: [{ title: `Factura ${req.invoiceId}`, quantity: 1, unit_price: req.amountCents / 100 }],
      payer: { email: req.customerEmail },
      notification_url: process.env.MP_WEBHOOK_URL,
    };
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`MercadoPago API error: ${response.status}`);
    const data = await response.json() as { id: string; init_point: string };
    return {
      providerOrderId: data.id,
      checkoutUrl: data.init_point,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      rawPayload: data as unknown as Record<string, unknown>,
    };
  }

  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): WebhookVerifyResult {
    // Igual que OpenPay: con secreto configurado la firma se verifica siempre,
    // aunque falte el access token y el provider esté en modo simulado.
    if (!secret) {
      return SIMULATED ? { valid: true } : { valid: false, reason: 'missing_secret_or_signature' };
    }
    if (!signature) return { valid: false, reason: 'missing_secret_or_signature' };
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    // timingSafeEqual lanza si los buffers difieren en longitud: comparar
    // longitud primero evita un 500 ante una firma malformada (queda 400 limpio).
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: 'signature_mismatch' };
    }
    return { valid: true };
  }

  async getPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    if (SIMULATED) {
      return { providerOrderId, status: 'pending', rawPayload: { simulated: true } };
    }
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${providerOrderId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    if (!response.ok) return { providerOrderId, status: 'unknown' };
    const data = await response.json() as { status: string; date_approved?: string; transaction_amount?: number };
    const statusMap: Record<string, ProviderPaymentStatus['status']> = {
      approved: 'approved', rejected: 'rejected', cancelled: 'cancelled', pending: 'pending',
    };
    return {
      providerOrderId,
      status: statusMap[data.status] ?? 'unknown',
      paidAt: data.date_approved,
      amountCents: data.transaction_amount ? Math.round(data.transaction_amount * 100) : undefined,
      rawPayload: data as unknown as Record<string, unknown>,
    };
  }
}
