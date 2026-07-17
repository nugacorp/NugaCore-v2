// ====================================================================
// Provider OpenPay (Fase 4.8) — tarjeta y SPEI/CoDi.
//
// Configurable con OPENPAY_MERCHANT_ID + OPENPAY_PRIVATE_KEY.
// Opera en modo simulado cuando no hay credenciales.
// Firma de webhook: X-OpenPay-Signature con HMAC-SHA256.
//
// Modo de cargo (chargeMethod):
//   - 'card'         → cobro con tarjeta (redirect / hosted).
//   - 'bank_account' → cobro SPEI/CoDi: OpenPay devuelve una CLABE virtual +
//                       referencia (y `agreement` para CoDi) a la que el cliente
//                       transfiere; el abono se confirma por webhook.
//
// ADVERTENCIA: la vía SPEI/bank_account NO está verificada end-to-end contra la
// API real de OpenPay (falta sandbox). La forma del request/response sigue la
// documentación de OpenPay, pero debe validarse con credenciales de sandbox
// antes de usarla en producción. El modo simulado es seguro (no llama a la red).
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

type ChargeMethod = 'card' | 'bank_account';

export class OpenPayProvider implements IPaymentProvider {
  readonly name: PaymentProvider;

  constructor(
    name: PaymentProvider = 'openpay',
    private readonly chargeMethod: ChargeMethod = 'card',
  ) {
    this.name = name;
  }

  async createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    return this.chargeMethod === 'bank_account'
      ? this.createSpeiOrder(req)
      : this.createCardOrder(req);
  }

  private async createCardOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    if (SIMULATED) {
      return {
        providerOrderId: `op-sim-${req.orderId}`,
        checkoutUrl: `https://openpay.sim/checkout/${req.orderId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        rawPayload: { simulated: true, provider: 'openpay', method: 'card', orderId: req.orderId },
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

  // SPEI/CoDi: cobro por transferencia con CLABE virtual + referencia.
  // OpenPay: POST charge con method='bank_account'. El response trae
  // payment_method.{clabe,name,agreement} — la CLABE a la que paga el cliente
  // (agreement = convenio CoDi). No hay checkoutUrl; el cliente transfiere.
  private async createSpeiOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    const reference = `${req.invoiceId}-${req.customerId}`.toUpperCase();
    if (SIMULATED) {
      return {
        providerOrderId: `op-spei-sim-${req.orderId}`,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        rawPayload: {
          simulated: true,
          provider: 'openpay',
          method: 'bank_account',
          reference,
          clabe: '646180111812345678',
          bank: 'STP',
          instructions: `Transferencia SPEI por referencia ${reference} (simulado)`,
        },
      };
    }
    const body = {
      method: 'bank_account',
      amount: req.amountCents / 100,
      currency: 'MXN',
      description: `Factura ${req.invoiceId}`,
      order_id: req.orderId,
      customer: { email: req.customerEmail || 'cliente@nugacore.mx' },
    };
    const response = await fetch(`${OP_BASE}/v1/${OP_MERCHANT_ID}/charges`, {
      method: 'POST',
      headers: { Authorization: basicAuth(OP_PRIVATE_KEY), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OpenPay API error: ${response.status}`);
    const data = await response.json() as {
      id: string;
      due_date?: string;
      payment_method?: { clabe?: string; name?: string; agreement?: string };
    };
    return {
      providerOrderId: data.id,
      expiresAt: data.due_date,
      rawPayload: {
        ...(data as unknown as Record<string, unknown>),
        reference,
        clabe: data.payment_method?.clabe,
        agreement: data.payment_method?.agreement,
      },
    };
  }

  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): WebhookVerifyResult {
    if (SIMULATED) return { valid: true };
    if (!secret || !signature) return { valid: false, reason: 'missing_secret_or_signature' };
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
    const response = await fetch(`${OP_BASE}/v1/${OP_MERCHANT_ID}/charges/${providerOrderId}`, {
      headers: { Authorization: basicAuth(OP_PRIVATE_KEY) },
    });
    if (!response.ok) return { providerOrderId, status: 'unknown' };
    const data = await response.json() as { status: string; operation_date?: string; amount?: number };
    const statusMap: Record<string, ProviderPaymentStatus['status']> = {
      completed: 'approved', failed: 'rejected', cancelled: 'cancelled', charge_pending: 'pending',
      in_progress: 'pending',
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
