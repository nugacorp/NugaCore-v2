// ====================================================================
// Provider manual (Fase 4.8).
// Registra pagos sin checkout externo. El operador confirma el pago
// directamente (transferencia, efectivo, depósito bancario).
// También se usa como stub para spei_provider_future.
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

export class ManualProvider implements IPaymentProvider {
  readonly name: PaymentProvider = 'manual';

  async createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    return {
      providerOrderId: `manual-${req.orderId}`,
      rawPayload: {
        provider: 'manual',
        orderId: req.orderId,
        amountCents: req.amountCents,
        createdAt: new Date().toISOString(),
      },
    };
  }

  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): WebhookVerifyResult {
    // Seguridad (C-01): si hay secreto configurado (WEBHOOK_SECRET_MANUAL) se
    // EXIGE firma HMAC-SHA256, igual que mercado_pago/openpay. Sin secreto se
    // conserva el comportamiento legacy; el runtime endurecido exige el secreto
    // a nivel de ruta (fail-closed), de modo que el endpoint publico nunca
    // aprueba pagos sin verificacion.
    if (!secret) return { valid: true };
    if (!signature) return { valid: false, reason: 'missing_signature' };
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false, reason: 'signature_mismatch' };
    }
    return { valid: true };
  }

  async getPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    return {
      providerOrderId,
      status: 'pending',
      rawPayload: { provider: 'manual', note: 'Estado verificado manualmente por operador' },
    };
  }
}
