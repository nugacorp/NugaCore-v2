// ====================================================================
// Identidades durables del flujo de webhook (T5).
//
// La garantía de "un efecto de cada tipo por reactivación" se apoya en que
// TODOS los owners de un mismo cobro deriven exactamente las mismas claves.
// Por eso la raíz sale de la identidad de ledger resuelta por Billing y los
// pasos salen de la acción durable, nunca del delivery ni de un ID provisional.
//
// Las claves son tenant-scoped por construcción: el índice único de cada
// destino es (tenant_id, idempotency_key), así que dos WISP pueden compartir
// el texto de la clave sin colisionar.
// ====================================================================

import type { WebhookReactivationStep } from './types';

/**
 * Raíz de identidad: una acción por cobro canónico y cliente. Dos deliveries
 * del mismo charge reciben el mismo `actionId` y la misma familia de pasos.
 */
export const rootActionIdempotencyKey = (canonicalPaymentId: string, customerId: string): string =>
  `payment:${canonicalPaymentId}:reactivate:${customerId}`;

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
