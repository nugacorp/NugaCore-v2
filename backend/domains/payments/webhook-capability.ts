// ====================================================================
// Capability del webhook idempotente (T5) — se evalúa ANTES del primer efecto.
//
// Hay dos formas de romper la garantía sin que ningún test de unicidad lo
// note, y las dos se cierran aquí:
//
//   1. Topología incoherente. El claim vive en `payment_events` (Payments) y
//      el ledger en `invoices/payments` (Billing). Si cada dominio apunta a un
//      backend distinto, ninguna transacción puede validar el claim y tocar el
//      ledger a la vez; un fence previo en Node reabre exactamente la ventana
//      que T5 cierra. Por eso sólo Store/Store y Supabase/Supabase están
//      soportados, y los dos tuples mixtos quedan no-ready.
//
//   2. Binario nuevo contra schema viejo. Descubrir que falta la RPC DESPUÉS
//      de haber creado la acción raíz deja el flujo a medias. La comprobación
//      va antes de reclamar el evento, y nunca degrada a la ruta insegura.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { ServiceUnavailableError } from '../../common/errors';
import { isDomainOnDb } from '../../config/feature-flags';
import { supabaseAdmin } from '../../services/supabase-admin';

export const WEBHOOK_SCHEMA_CAPABILITY_RPC = 'payments_webhook_schema_capability';

export type WebhookCapabilityCode =
  | 'ready'
  | 'persistence_tuple_mixed'
  | 'supabase_not_configured'
  | 'schema_not_ready';

export interface WebhookCapabilityResult {
  ready: boolean;
  code: WebhookCapabilityCode;
  reason?: string;
  /** Objetos de schema que faltan, tal como los reporta la RPC del catálogo. */
  missing?: string[];
}

const READY: WebhookCapabilityResult = { ready: true, code: 'ready' };

const asMissingList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry));
};

/**
 * @param client Cliente Supabase a usar en modo DB. Por defecto el admin del
 * proceso; los tests inyectan el suyo para ejercitar schema viejo/incompleto.
 */
export const evaluateWebhookCapability = async (
  client: SupabaseClient | null = supabaseAdmin,
): Promise<WebhookCapabilityResult> => {
  const paymentsOnDb = isDomainOnDb('payments');
  const billingOnDb = isDomainOnDb('billing');
  const customersOnDb = isDomainOnDb('customers');
  const suspensionOnDb = isDomainOnDb('suspension');

  if (paymentsOnDb !== billingOnDb) {
    return {
      ready: false,
      code: 'persistence_tuple_mixed',
      reason:
        'El claim de payment_events y el ledger de Billing deben compartir backend: '
        + `USE_DB_PAYMENTS=${paymentsOnDb} y USE_DB_BILLING=${billingOnDb} no es una topología soportada.`,
    };
  }

  // Store/Store serializa claim+ledger en el proceso, pero sus destinos pueden
  // combinarse con Supabase. En ese caso timeline/alerta (Customers) u
  // orden/evento (Suspension) también necesitan el schema durable antes de que
  // la acción raíz Store se cree. Sólo el tuple completamente Store evita RPC.
  const anyWebhookTargetOnDb = paymentsOnDb || customersOnDb || suspensionOnDb;
  if (!anyWebhookTargetOnDb) return READY;

  if (!client) {
    return {
      ready: false,
      code: 'supabase_not_configured',
      reason: 'Modo DB sin cliente Supabase configurado.',
    };
  }

  const { data, error } = await client.rpc(WEBHOOK_SCHEMA_CAPABILITY_RPC);
  // La ausencia de la RPC ES el schema viejo. No se interpreta como "todo bien".
  if (error) {
    return {
      ready: false,
      code: 'schema_not_ready',
      reason: `No se pudo verificar el schema de idempotencia: ${error.message}`,
    };
  }

  const payload = (Array.isArray(data) ? data[0] : data) as
    | { ready?: unknown; missing?: unknown }
    | null;
  if (!payload || payload.ready !== true) {
    return {
      ready: false,
      code: 'schema_not_ready',
      reason: 'El schema de idempotencia durable está incompleto.',
      missing: asMissingList(payload?.missing),
    };
  }
  return READY;
};

/** Falla cerrado con 503 retryable; nunca deja continuar con efectos. */
export const assertWebhookCapability = async (
  client: SupabaseClient | null = supabaseAdmin,
): Promise<void> => {
  const capability = await evaluateWebhookCapability(client);
  if (capability.ready) return;
  const detail = capability.missing?.length ? ` Faltan: ${capability.missing.join(', ')}.` : '';
  throw new ServiceUnavailableError(
    `${capability.reason ?? 'Webhook no disponible.'}${detail}`,
    'WEBHOOK_NOT_READY',
  );
};
