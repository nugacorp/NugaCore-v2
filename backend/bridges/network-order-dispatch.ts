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
}): Promise<void> {
  const repo = getSuspensionService().repo;
  await repo.createOrder({
    customerId: input.customerId,
    orderType: input.orderType,
    source: input.source,
    reason: input.reason,
  });
  if (productionGates.mikrotikWorkerCommit()) {
    await processPendingOrders(input.actor ?? input.source);
  }
}
