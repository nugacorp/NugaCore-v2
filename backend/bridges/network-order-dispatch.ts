// ====================================================================
// Puente gated: encola órdenes de red y dispara worker MikroTik.
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
  /** Identidad durable (T5): con ella la orden es create-or-return. */
  idempotencyKey?: string;
}

type NetworkOrderDispatchInput =
  | (BaseNetworkOrderDispatchInput & {
      source: 'payment-engine';
      tenantId: string;
      routerId: string;
    })
  | (BaseNetworkOrderDispatchInput & {
      source: Exclude<SuspensionOrderSource, 'payment-engine' | 'manual'>;
      tenantId?: string;
      routerId?: string;
    });

const requirePaymentScope = (value: string, field: 'tenantId' | 'routerId'): string => {
  const scoped = (value ?? '').trim();
  if (!scoped) throw new Error(`dispatchNetworkOrder(payment-engine): ${field} es obligatorio.`);
  return scoped;
};

export async function dispatchNetworkOrder(input: NetworkOrderDispatchInput): Promise<SuspensionOrder> {
  const repo = getSuspensionService().repo;
  const order = input.source === 'payment-engine'
    ? await repo.createOrder({
        customerId: input.customerId,
        orderType: input.orderType,
        source: input.source,
        reason: input.reason,
        tenantId: requirePaymentScope(input.tenantId, 'tenantId'),
        routerId: requirePaymentScope(input.routerId, 'routerId'),
        idempotencyKey: input.idempotencyKey,
      })
    : await repo.createOrder({
        customerId: input.customerId,
        orderType: input.orderType,
        source: input.source,
        reason: input.reason,
        tenantId: input.tenantId,
        routerId: input.routerId,
        idempotencyKey: input.idempotencyKey,
      });
  // El worker puede procesar la MISMA fila más de una vez: la garantía de T5
  // es una orden durable, no una única invocación ni exactly-once en RouterOS.
  if (productionGates.mikrotikWorkerCommit()) {
    await processPendingOrders(input.actor ?? input.source, {
      tenantId: order.tenantId || input.tenantId || 'tenant-default',
      orderId: order.id,
      routerId: order.routerId || input.routerId || '',
    });
  }
  return order;
}
