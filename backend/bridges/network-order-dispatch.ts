// ====================================================================
// Puente gated: encola órdenes de red y dispara worker MikroTik.
// Vive fuera de service-status para mantener el guard estático Pre-PROD-7.
// ====================================================================

import { productionGates } from '../config/production-gates';
import { processPendingOrders } from '../domains/mikrotik/worker/worker';
import { getSuspensionService } from '../domains/suspension/service';

export async function dispatchNetworkOrder(input: {
  customerId: string;
  orderType: 'suspension' | 'reactivation';
  source: 'service-status' | 'provisioning-center' | 'payment-engine' | 'engine';
  reason: string;
  actor: string | null;
  /** Identidad durable (T5): con ella la orden es create-or-return. */
  tenantId?: string;
  idempotencyKey?: string;
}): Promise<void> {
  const repo = getSuspensionService().repo;
  const order = await repo.createOrder({
    customerId: input.customerId,
    orderType: input.orderType,
    source: input.source,
    reason: input.reason,
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
  });
  // El worker puede procesar la MISMA fila más de una vez: la garantía de T5
  // es una orden durable, no una única invocación ni exactly-once en RouterOS.
  if (productionGates.mikrotikWorkerCommit()) {
    await processPendingOrders(input.actor ?? input.source, {
      tenantId: order.tenantId || input.tenantId || 'tenant-default',
      orderId: order.id,
    });
  }
}
