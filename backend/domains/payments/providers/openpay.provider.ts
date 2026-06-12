// ====================================================================
// Provider OpenPay (Fase 4.8).
// Implementación de referencia para OpenPay México.
// Configurable con OPENPAY_MERCHANT_ID + OPENPAY_PRIVATE_KEY.
// Opera en modo simulado cuando no hay credenciales.
// Firma de webhook: X-OpenPay-Signature con HMAC-SHA256.
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

const OP_MERCHANT_ID = process.env.OPENPAY_MERCHANT_ID || '';
const OP_PRIVATE_KEY = process.env.OPENPAY_PRIVATE_KEY || '';
const SIMULATED = !OP_MERCHANT_ID || !OP_PRIVATE_KEY;
const OP_BASE = process.env.OPENPAY_SANDBOX === 'false'
  ? 'https://api.openpay.mx'
  : 'https://sandbox-api.openpay.mx';

const basicAuth = (key: string) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

export class OpenPayProvider implements IPaymentProvider {
  readonly name: PaymentProvider = 'openpay';

  async createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    if (SIMULATED) {
      return {
        providerOrderId: `op-sim-${req.orderId}`,
        checkoutUrl: `https://openpay.sim/checkout/${req.orderId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        rawPayload: { simulated: true, provider: 'openpay', orderId: req.orderId },
      };
    }
    const body = {
      method: 'card',
      amount: req.amountCents / 100,
      currency: 'MXN',
      description: `Factura ${req.invoiceId}`,
      order_id: req.orderId,
      customer: { email: req.customerEmail || 'cliente@nugacore.mx' },
      redirect_url: process.env.OPENPAY_REDIRECT_URL || 'https://app.nugacore.mx/payments/callback',
    };
    const response = await fetch(`${OP_BASE}/v1/${OP_MERCHANT_ID}/charges`, {
      method: 'POST',
      headers: { Authorization: basicAuth(OP_PRIVATE_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OpenPay API error: ${response.status}`);
    const data = await response.json() as { id: string; payment_method?: { url?: string }; due_date?: string };
    return {
      providerOrderId: data.id,
      checkoutUrl: data.payment_method?.url,
      expiresAt: data.due_date,
      rawPayload: data as unknown as Record<string, unknown>,
    };
  }

  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): WebhookVerifyResult {
    if (SIMULATED) return { valid: true };
    if (!secret || !signature) return { valid: false, reason: 'missing_secret_or_signature' };
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    return valid ? { valid: true } : { valid: false, reason: 'signature_mismatch' };
  }

  async getPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    if (SIMULATED) {
      return { providerOrderId, status: 'pending', rawPayload: { simulated: true } };
    }
    const response = await fetch(`${OP_BASE}/v1/${OP_MERCHANT_ID}/charges/${providerOrderId}`, {
      headers: { Authorization: basicAuth(OP_PRIVATE_KEY) },
    });
    if (!response.ok) return { providerOrderId, status: 'unknown' };
    const data = await response.json() as { status: string; operation_date?: string; amount?: number };
    const statusMap: Record<string, ProviderPaymentStatus['status']> = {
      completed: 'approved', failed: 'rejected', cancelled: 'cancelled', charge_pending: 'pending',
    };
    return {
      providerOrderId,
      status: statusMap[data.status] ?? 'unknown',
      paidAt: data.operation_date,
      amountCents: data.amount ? Math.round(data.amount * 100) : undefined,
      rawPayload: data as unknown as Record<string, unknown>,
    };
  }
}
