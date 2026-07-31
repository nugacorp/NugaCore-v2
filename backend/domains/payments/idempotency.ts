// ====================================================================
// Identidades durables del flujo de webhook (T5).
//
// La garantía de "un efecto de cada tipo por reactivación" se apoya en que
// TODOS los owners de un mismo evento deriven exactamente las mismas claves.
// Por eso las claves salen de la fila durable del evento y de la acción raíz,
// nunca de un id generado en el proceso.
//
// Las claves son tenant-scoped por construcción: el índice único de cada
// destino es (tenant_id, idempotency_key), así que dos WISP pueden compartir
// el texto de la clave sin colisionar.
// ====================================================================

import type { WebhookReactivationStep } from './types';

/**
 * Raíz de identidad: una acción de reactivación por evento de pago y cliente.
 * A y B reciben el mismo `actionId` y por tanto la misma familia de pasos.
 */
export const rootActionIdempotencyKey = (paymentEventId: string, customerId: string): string =>
  `pe:${paymentEventId}:reactivate:${customerId}`;

/** Identidad de cada efecto derivado. Estable a través de owners y reintentos. */
export const stepIdempotencyKey = (actionId: string, step: WebhookReactivationStep): string =>
  `${actionId}:${step}`;

/**
 * Identidad del cobro Billing, independiente de la entrega. Dos event IDs
 * distintos del mismo proveedor pueden representar el mismo charge/order;
 * ambos deben recuperar una sola fila tenant-scoped.
 */
export const webhookPaymentIdempotencyKey = (
  provider: string,
  transactionId: string,
): string => `charge:${provider.toLowerCase()}:${transactionId}`;
