// ====================================================================
// Provider manual (Fase 4.8).
// Registra pagos sin checkout externo. El operador confirma el pago
// directamente (transferencia, efectivo, depósito bancario).
// También se usa como stub para spei_provider_future.
// ====================================================================

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

  verifyWebhook(_rawBody: string | Buffer, _signature: string, _secret: string): WebhookVerifyResult {
    // Webhooks manuales no requieren firma — el operador llama directamente al endpoint
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
