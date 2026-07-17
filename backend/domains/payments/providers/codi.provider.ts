// CoDi / SPEI — cobro por transferencia con referencia de factura.
import crypto from 'crypto';
import { PaymentProvider } from '../types';
import {
  IPaymentProvider,
  PaymentOrderRequest,
  PaymentOrderResponse,
  ProviderPaymentStatus,
  WebhookVerifyResult,
} from './index';

export class CodiProvider implements IPaymentProvider {
  readonly name: PaymentProvider = 'codi';

  async createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse> {
    const reference = `${req.invoiceId}-${req.customerId}`.toUpperCase();
    return {
      providerOrderId: reference,
      rawPayload: {
        provider: 'codi',
        reference,
        orderId: req.orderId,
        amountCents: req.amountCents,
      },
    };
  }

  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): WebhookVerifyResult {
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
      rawPayload: { provider: 'codi' },
    };
  }
}
