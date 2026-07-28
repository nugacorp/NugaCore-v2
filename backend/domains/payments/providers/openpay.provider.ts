// ====================================================================
// Provider OpenPay (Fase 4.8) — tarjeta y SPEI/CoDi.
//
// Las credenciales llegan INYECTADAS (OpenPayResolvedConfig), resueltas de la
// fila `wisp_integration_settings` del WISP activo — ver openpay-config.ts.
// Sin config explícita se usa el entorno (compatibilidad single-WISP).
// Opera en modo simulado cuando no hay credenciales utilizables.
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
  isUsableOpenPayConfig,
  openPayConfigFromEnv,
  type OpenPayResolvedConfig,
} from './openpay-config';
import {
  IPaymentProvider,
  PaymentOrderRequest,
  PaymentOrderResponse,
  ProviderPaymentStatus,
  WebhookVerifyResult,
} from './index';

const basicAuth = (key: string) => 'Basic ' + Buffer.from(`${key}:`).toString('base64');

type ChargeMethod = 'card' | 'bank_account';

export class OpenPayProvider implements IPaymentProvider {
  readonly name: PaymentProvider;

  private readonly config: OpenPayResolvedConfig;
  private readonly simulated: boolean;

  constructor(
    name: PaymentProvider = 'openpay',
    private readonly chargeMethod: ChargeMethod = 'card',
    config?: OpenPayResolvedConfig,
  ) {
    this.name = name;
    this.config = config ?? openPayConfigFromEnv();
    this.simulated = !isUsableOpenPayConfig(this.config);
  }

  /** Host de la API según el modo sandbox del WISP. */
  private get baseUrl(): string {
    return this.config.sandbox ? 'https://sandbox-api.openpay.mx' : 'https://api.openpay.mx';
  }

  private get chargesUrl(): string {
    return `${this.baseUrl}/v1/${this.config.merchantId.trim()}/charges`;
  }

  private get authHeader(): string {
    return basicAuth(this.config.privateKey.trim());
  }

  async createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    return this.chargeMethod === 'bank_account'
      ? this.createSpeiOrder(req)
      : this.createCardOrder(req);
  }

  private async createCardOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    if (this.simulated) {
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
    const response = await fetch(this.chargesUrl, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
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
    if (this.simulated) {
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
    const response = await fetch(this.chargesUrl, {
      method: 'POST',
      headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
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
    if (this.simulated) return { valid: true };
    // El secreto de la ruta manda; si no lo aporta, se usa el del WISP.
    const effectiveSecret = secret || this.config.webhookSecret || '';
    if (!effectiveSecret || !signature) return { valid: false, reason: 'missing_secret_or_signature' };
    const expected = crypto.createHmac('sha256', effectiveSecret).update(rawBody).digest('hex');
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
    if (this.simulated) {
      return { providerOrderId, status: 'pending', rawPayload: { simulated: true } };
    }
    const response = await fetch(`${this.chargesUrl}/${providerOrderId}`, {
      headers: { Authorization: this.authHeader },
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
