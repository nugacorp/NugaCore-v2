// ====================================================================
// Interfaz PaymentProvider y factoría de providers (Fase 4.8).
// Desacopla el Payment Engine de cualquier proveedor específico.
// ====================================================================

import { PaymentProvider } from '../types';
import { ManualProvider } from './manual.provider';
import { MercadoPagoProvider } from './mercadopago.provider';
import { OpenPayProvider } from './openpay.provider';
import { resolveOpenPayConfig } from './openpay-config';
import { CodiProvider } from './codi.provider';

// ── Interfaz desacoplada ──────────────────────────────────────────────

export interface PaymentOrderRequest {
  orderId: string;
  invoiceId: string;
  customerId: string;
  amountCents: number;
  description?: string;
  customerEmail?: string;
}

export interface PaymentOrderResponse {
  providerOrderId: string;
  checkoutUrl?: string;
  expiresAt?: string;
  rawPayload?: Record<string, unknown>;
}

export interface WebhookVerifyResult {
  valid: boolean;
  reason?: string;
}

export interface ProviderPaymentStatus {
  providerOrderId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'unknown';
  paidAt?: string;
  amountCents?: number;
  rawPayload?: Record<string, unknown>;
}

export interface IPaymentProvider {
  name: PaymentProvider;
  createPaymentOrder(req: PaymentOrderRequest): Promise<PaymentOrderResponse>;
  verifyWebhook(rawBody: string | Buffer, signature: string, secret: string): WebhookVerifyResult;
  getPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus>;
}

// ── Factoría ──────────────────────────────────────────────────────────

const providers: Record<PaymentProvider, IPaymentProvider> = {
  manual: new ManualProvider(),
  mercado_pago: new MercadoPagoProvider(),
  openpay: new OpenPayProvider(),
  // SPEI/CoDi por OpenPay (method='bank_account'): CLABE virtual + referencia.
  // Reemplaza el ManualProvider placeholder. Gateado por credenciales OpenPay
  // (sin ellas, modo simulado seguro). Ver openpay.provider.ts.
  spei: new OpenPayProvider('spei', 'bank_account'),
  codi: new CodiProvider(),
};

export const getProvider = (name: PaymentProvider): IPaymentProvider => {
  const p = providers[name];
  if (!p) throw new Error(`Provider desconocido: ${name}`);
  return p;
};

/**
 * Provider del WISP activo. OpenPay (tarjeta y SPEI) se construye por petición
 * con las credenciales de la fila de integraciones del tenant; el resto de
 * providers no dependen de credenciales por WISP y siguen siendo singletons.
 */
export const resolveProvider = async (
  name: PaymentProvider,
  tenantId?: string,
): Promise<IPaymentProvider> => {
  if (name === 'openpay' || name === 'spei') {
    const config = await resolveOpenPayConfig(tenantId);
    return new OpenPayProvider(name, name === 'spei' ? 'bank_account' : 'card', config);
  }
  return getProvider(name);
};
