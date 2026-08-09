// ====================================================================
// Puente gated: persiste órdenes y procesa una fila con scope explícito.
// Vive fuera de service-status para mantener el guard estático Pre-PROD-7.
// ====================================================================

import { productionGates } from '../config/production-gates';
import { processPendingOrders } from '../domains/mikrotik/worker/worker';
import { getSuspensionService } from '../domains/suspension/service';
import type { SuspensionOrder, SuspensionOrderSource } from '../domains/suspension/types';

interface BaseNetworkOrderDispatchInput {
  customerId: string;
  orderType: 'suspension' | 'reactivation';
  reason: string;
  actor: string | null;
  idempotencyKey?: string;
}

export type NetworkOrderDispatchInput =
  | (BaseNetworkOrderDispatchInput & {
      source: 'payment-engine';
      tenantId: string;
      routerId: string;
      idempotencyKey: string;
    })
  | (BaseNetworkOrderDispatchInput & {
      source: Exclude<SuspensionOrderSource, 'payment-engine' | 'manual'>;
      tenantId?: string;
      routerId?: string;
    });

const requirePaymentScope = (
  value: string,
  field: 'tenantId' | 'routerId' | 'idempotencyKey',
): string => {
  const scoped = (value ?? '').trim();
  if (!scoped) throw new Error(`dispatchNetworkOrder(payment-engine): ${field} es obligatorio.`);
  return scoped;
};

/** Persiste o recupera la orden durable. No ejecuta ningún efecto de red. */
export async function createOrGetNetworkOrder(
  input: NetworkOrderDispatchInput,
): Promise<SuspensionOrder> {
  const repo = getSuspensionService().repo;
  return input.source === 'payment-engine'
    ? repo.createOrder({
        customerId: input.customerId,
        orderType: input.orderType,
        source: input.source,
        reason: input.reason,
        tenantId: requirePaymentScope(input.tenantId, 'tenantId'),
        routerId: requirePaymentScope(input.routerId, 'routerId'),
        idempotencyKey: requirePaymentScope(input.idempotencyKey, 'idempotencyKey'),
      })
    : repo.createOrder({
        customerId: input.customerId,
        orderType: input.orderType,
        source: input.source,
        reason: input.reason,
        tenantId: input.tenantId,
        routerId: input.routerId,
        idempotencyKey: input.idempotencyKey,
      });
}

/** Procesa exclusivamente la fila ya persistida y su scope F2. */
export async function processNetworkOrder(
  order: SuspensionOrder,
  actor: string | null,
): Promise<SuspensionOrder> {
  if (productionGates.mikrotikWorkerCommit()) {
    if (!order.tenantId?.trim() || !order.routerId?.trim()) {
      throw new Error('processNetworkOrder: orden durable sin tenantId/routerId.');
    }
    await processPendingOrders(actor ?? order.source, {
      tenantId: order.tenantId,
      orderId: order.id,
      routerId: order.routerId,
    });
  }
  return order;
}

/** Compatibilidad para los demás dominios: persiste y luego procesa. */
export async function dispatchNetworkOrder(
  input: NetworkOrderDispatchInput,
): Promise<SuspensionOrder> {
  const order = await createOrGetNetworkOrder(input);
  return processNetworkOrder(order, input.actor);
}
