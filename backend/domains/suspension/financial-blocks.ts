// ====================================================================
// Bloqueos financieros del Motor de Suspensiones (B1).
//
// `customer_suspension_blocks` es la ÚNICA autoridad estructurada sobre la
// causa de una suspensión activa: `classifyActiveSuspension` clasifica como
// `unknown` a todo cliente suspendido sin fila activa, y la reactivación
// automática por pago falla cerrada ante `unknown`.
//
// Hasta B1 el único productor era la suspensión MANUAL, que siempre escribe
// `non_financial`. Un cliente cortado por morosidad quedaba, por tanto, sin
// evidencia — y `eligible` era inalcanzable por el ciclo real.
//
// Este módulo define el contrato del bloqueo que emite el motor:
//   - `category`     siempre 'financial' (deuda regularizable con un pago).
//   - `source`       'suspension-engine' (no es una acción de operador).
//   - `evidenceType` 'suspension_order'.
//   - `evidenceId`   el id durable de la orden que causó el corte.
//
// La evidencia es la clave de la idempotencia: el índice único parcial
// `(tenant_id, evidence_type, evidence_id)` de
// `20260814050000_customer_suspension_blocks.sql` convierte el alta en
// create-or-return, así que reevaluar al mismo cliente converge al MISMO
// bloqueo tanto en el store en memoria como en Supabase.
//
// No decide nada de red ni toca RouterOS: sólo persiste evidencia.
// ====================================================================

import { DEFAULT_TENANT_ID } from '../tenancy/types';
import type { SuspensionRepository } from './repository';
import type { BillingStatus, CustomerSuspensionBlock, SuspensionOrder } from './types';

/** `source` de un bloqueo emitido por el motor, no por un operador. */
export const ENGINE_FINANCIAL_BLOCK_SOURCE = 'suspension-engine';

/** Tipo de evidencia: la orden de suspensión que causó el corte. */
export const ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE = 'suspension_order';

const resolveTenant = (tenantId: string | undefined | null): string => tenantId || DEFAULT_TENANT_ID;

/**
 * Una orden sirve como evidencia financiera SOLO si el motor la emitió por
 * morosidad. Las órdenes manuales, de payment-engine o de otros productores
 * describen otra intención y no autorizan un bloqueo `financial`.
 */
export const isEngineFinancialSuspensionOrder = (
  order: SuspensionOrder | undefined | null,
): order is SuspensionOrder =>
  Boolean(order) && order!.orderType === 'suspension' && order!.source === 'engine';

/** Localiza la orden abierta del motor que debe respaldar el bloqueo. */
export const findEngineFinancialOrder = (
  orders: SuspensionOrder[],
  tenantId: string,
  customerId: string,
): SuspensionOrder | undefined =>
  orders.find(
    (order) => isEngineFinancialSuspensionOrder(order)
      && order.customerId === customerId
      && resolveTenant(order.tenantId) === tenantId,
  );

/**
 * ¿Esta orden demuestra un corte REAL ya confirmado en RouterOS?
 *
 * `status = 'EXECUTED'` por sí solo NO alcanza: el atajo dry-run también marca
 * EXECUTED con `executedAt`, y una orden simulada nunca suspendió a nadie.
 * La prueba de que el efecto cruzó de verdad son los checkpoints durables que
 * el worker escribe alrededor del límite RouterOS:
 *
 *   effectStartedAt   → justo antes de enviar los comandos
 *   effectConfirmedAt → sólo cuando RouterOS respondió OK
 *
 * Se exigen los cinco campos a la vez. Una fila histórica sin ellos (o con
 * `dryRun` indefinido) queda fuera a propósito: sin evidencia suficiente,
 * fail-closed y revisión manual.
 */
export const hasConfirmedRouterExecution = (order: SuspensionOrder): boolean =>
  order.status === 'EXECUTED'
  && order.dryRun === false
  && Boolean(order.executedAt)
  && Boolean(order.effectStartedAt)
  && Boolean(order.effectConfirmedAt);

/**
 * Reconciliación de una orden que YA NO está abierta (el worker la ejecutó
 * antes de que su bloqueo llegara a persistir).
 *
 * Dos filtros acumulativos:
 *
 *   1. Evidencia REAL de ejecución (`hasConfirmedRouterExecution`). Una orden
 *      CANCELLED, FAILED, PENDING, QUEUED sin efecto confirmado o ejecutada
 *      sólo en dry-run nunca se convierte en evidencia `financial`. Sin esto,
 *      un cliente suspendido por una causa legacy o no financiera, con una
 *      orden vieja abortada para la misma factura, podría volverse elegible
 *      tras un pago — exactamente lo contrario del fail-closed.
 *
 *   2. Asociación INEQUÍVOCA: exactamente una candidata en este tenant, para
 *      este cliente y ligada a la MISMA factura que hoy sigue impagada. Cero
 *      o varias devuelven `undefined` en vez de adivinar.
 *
 * No es un backfill de clientes legacy: un suspendido sin una orden del motor
 * realmente ejecutada no produce evidencia por este camino y sigue siendo
 * `unknown`/fail-closed.
 *
 * La reparación ANTES del efecto no pasa por aquí: la cubre
 * `findEngineFinancialOrder` sobre las órdenes abiertas.
 */
export const findDeterministicEngineFinancialOrder = (
  orders: SuspensionOrder[],
  tenantId: string,
  customerId: string,
  invoiceId: string | undefined,
): SuspensionOrder | undefined => {
  if (!invoiceId) return undefined;
  const candidates = orders.filter(
    (order) => isEngineFinancialSuspensionOrder(order)
      && order.customerId === customerId
      && resolveTenant(order.tenantId) === tenantId
      && order.invoiceId === invoiceId
      && hasConfirmedRouterExecution(order),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
};

export const engineFinancialBlockReason = (
  billingStatus: BillingStatus,
  graceDays: number,
  orderId: string,
): string =>
  `Suspension automatica por morosidad (${billingStatus}) fuera de la ventana de gracia `
  + `de ${graceDays} dias. Orden del motor: ${orderId}.`;

export interface EnsureEngineFinancialBlockInput {
  tenantId: string;
  customerId: string;
  order: SuspensionOrder;
  billingStatus: BillingStatus;
  graceDays: number;
}

/**
 * Garantiza que exista el bloqueo financiero de una orden de suspensión del
 * motor. Es idempotente por evidencia: llamarlo N veces con la misma orden
 * devuelve siempre la misma fila.
 *
 * No captura errores del repositorio a propósito. Si el write falla, la
 * evaluación falla de forma visible y la orden queda ABIERTA, así que la
 * siguiente evaluación reconcilia el bloqueo sin crear una segunda orden.
 */
export async function ensureEngineFinancialBlock(
  repo: SuspensionRepository,
  input: EnsureEngineFinancialBlockInput,
): Promise<CustomerSuspensionBlock> {
  const tenantId = (input.tenantId || '').trim();
  if (!tenantId) {
    throw new Error('ensureEngineFinancialBlock: tenantId es obligatorio.');
  }
  if (!isEngineFinancialSuspensionOrder(input.order)) {
    throw new Error(
      'ensureEngineFinancialBlock: la evidencia debe ser una orden de suspension del motor.',
    );
  }
  // Bloqueo, orden y cliente tienen que pertenecer al mismo WISP: una orden
  // de otro tenant nunca puede justificar un bloqueo aquí.
  if (input.order.customerId !== input.customerId) {
    throw new Error('ensureEngineFinancialBlock: la orden pertenece a otro cliente.');
  }
  if (resolveTenant(input.order.tenantId) !== tenantId) {
    throw new Error('ensureEngineFinancialBlock: la orden pertenece a otro tenant.');
  }

  return repo.createSuspensionBlock({
    tenantId,
    customerId: input.customerId,
    category: 'financial',
    source: ENGINE_FINANCIAL_BLOCK_SOURCE,
    reason: engineFinancialBlockReason(input.billingStatus, input.graceDays, input.order.id),
    evidenceType: ENGINE_FINANCIAL_BLOCK_EVIDENCE_TYPE,
    evidenceId: input.order.id,
  });
}
