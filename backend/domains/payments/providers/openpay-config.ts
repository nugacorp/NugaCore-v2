// ====================================================================
// Resolución de credenciales OpenPay POR WISP (tenant).
//
// Regla (slice "integraciones por tenant", decisión 2):
//   1. La fila `wisp_integration_settings` del tenant manda. Las credenciales
//      viven cifradas en reposo y el repositorio las descifra únicamente aquí,
//      en el borde donde se arma el request al proveedor.
//   2. `process.env` es fallback SOLO del tenant por defecto (single-WISP).
//      Nunca se usa para otro WISP: sería mezclar credenciales entre negocios.
//   3. Sin credenciales utilizables → config vacía ⇒ el provider entra en modo
//      simulado (fail-closed, sin llamadas de red).
//
// Nunca loguear ni serializar `privateKey`/`webhookSecret`.
// ====================================================================

import { logger } from '../../../common/logger';
import { DEFAULT_TENANT_ID } from '../../tenancy/types';

export interface OpenPayResolvedConfig {
  merchantId: string;
  privateKey: string;
  sandbox: boolean;
  /** Secreto de webhook del WISP; fallback del secreto que aporte la ruta. */
  webhookSecret?: string;
}

/** Config desde variables de entorno (compatibilidad single-WISP). */
export const openPayConfigFromEnv = (): OpenPayResolvedConfig => ({
  merchantId: process.env.OPENPAY_MERCHANT_ID || '',
  privateKey: process.env.OPENPAY_PRIVATE_KEY || '',
  // Igual que antes: sandbox salvo OPENPAY_SANDBOX='false' explícito.
  sandbox: process.env.OPENPAY_SANDBOX !== 'false',
  webhookSecret: process.env.WEBHOOK_SECRET_OPENPAY || '',
});

/** Config sin credenciales → provider en modo simulado. */
const simulatedConfig = (): OpenPayResolvedConfig => ({
  merchantId: '',
  privateKey: '',
  sandbox: true,
});

const isDefaultTenant = (tenantId?: string): boolean =>
  !tenantId || tenantId === DEFAULT_TENANT_ID;

export const isUsableOpenPayConfig = (config: OpenPayResolvedConfig): boolean =>
  Boolean(config.merchantId.trim() && config.privateKey.trim());

export const resolveOpenPayConfig = async (
  tenantId?: string,
): Promise<OpenPayResolvedConfig> => {
  try {
    // Import dinámico: integrations/service importa payments/service, y este
    // módulo cuelga de payments. Cargarlo aquí evita el ciclo en tiempo de carga.
    const { getIntegrationsService } = await import('../../integrations/service');
    const settings = await getIntegrationsService().getPersistedSettingsRaw(tenantId);
    if (settings) {
      if (!settings.openpayEnabled) return simulatedConfig();
      const fromTenantRow: OpenPayResolvedConfig = {
        merchantId: settings.openpayMerchantId.trim(),
        privateKey: settings.openpayPrivateKey.trim(),
        sandbox: settings.openpaySandbox,
        webhookSecret: settings.openpayWebhookSecret || undefined,
      };
      // El provider de cobro puede quedar simulado por merchant/private key
      // incompletos, pero el secreto de webhook sigue siendo autoritativo y
      // debe conservarse para verificar HMAC en la ruta legacy.
      return fromTenantRow;
    }

    // Compatibilidad single-WISP: env solo representa una instalación legacy
    // que nunca guardó la fila default. Una fila persistida siempre manda.
    if (isDefaultTenant(tenantId)) {
      const fromEnv = openPayConfigFromEnv();
      if (isUsableOpenPayConfig(fromEnv)) return fromEnv;
    }
  } catch (error) {
    // Un error de lectura no equivale a "fila ausente": queda fail-closed.
    // Se registra el motivo, jamás la credencial.
    logger.warn('OpenPay: no se pudieron leer las credenciales del WISP', {
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      reason: error instanceof Error ? error.message : 'error desconocido',
    });
  }

  return simulatedConfig();
};
