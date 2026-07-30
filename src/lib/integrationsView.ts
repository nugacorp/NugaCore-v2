// ====================================================================
// Helpers PUROS de presentación de Integraciones por WISP.
// Sin React/DOM → testeables en el entorno node.
// ====================================================================

export interface OpenPayWebhookInput {
  /** Origen actual del navegador (`window.location.origin`). '' fuera del DOM. */
  origin: string;
  /**
   * Ruta del webhook del WISP tal como la entrega el backend
   * (`/api/payments/webhook/openpay/<token>`). Nunca se arma aquí: si el
   * backend no la entrega, no hay URL que mostrar.
   */
  webhookPath: string;
  /** OpenPay habilitado en la configuración del WISP. */
  enabled: boolean;
}

export interface OpenPayWebhookView {
  /** true solo cuando hay URL real para registrar en OpenPay. */
  available: boolean;
  /** URL absoluta lista para copiar ('' cuando no hay nada que mostrar). */
  url: string;
  /** Texto que explica qué hacer con la URL o cómo obtenerla. */
  hint: string;
}

const READY_HINT =
  'Regístrala en el panel de OpenPay (Configuración → Webhooks) para recibir la confirmación de pagos de este WISP.';
const DISABLED_HINT =
  'Habilita OpenPay y guarda las credenciales para generar la URL única de webhook de este WISP.';
const PENDING_HINT =
  'Guarda las credenciales de OpenPay para generar la URL única de webhook de este WISP.';

/**
 * Deriva la URL de webhook OpenPay del WISP autenticado a partir del origen
 * actual y del `webhookPath` no secreto que entrega el backend.
 *
 * El token opaco viaja embebido en el path del backend: el cliente no lo
 * fabrica ni lo muestra por separado.
 */
export function openpayWebhookView({ origin, webhookPath, enabled }: OpenPayWebhookInput): OpenPayWebhookView {
  const path = webhookPath.trim();
  const base = origin.trim().replace(/\/+$/, '');
  if (!path || !base) {
    return { available: false, url: '', hint: enabled ? PENDING_HINT : DISABLED_HINT };
  }
  try {
    const url = new URL(base.includes('://') ? base : `https://${base}`);
    url.pathname = path.startsWith('/') ? path : `/${path}`;
    url.search = '';
    url.hash = '';
    return { available: true, url: url.toString(), hint: READY_HINT };
  } catch {
    return { available: false, url: '', hint: enabled ? PENDING_HINT : DISABLED_HINT };
  }
}
