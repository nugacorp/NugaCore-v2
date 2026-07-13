// ====================================================================
// Hooks de ejecución live para provisioning aprobado (gated).
// ====================================================================

import { dispatchNetworkOrder } from '../../bridges/network-order-dispatch';
import { logger } from '../../common/logger';
import { productionGates } from '../../config/production-gates';
import { getCustomersService } from '../customers/service';
import type { ProvisioningAction, ProvisioningActionType } from './types';

const orderTypeForAction = (
  actionType: ProvisioningActionType,
): 'suspension' | 'reactivation' | null => {
  if (actionType === 'SUSPEND_CUSTOMER' || actionType === 'CANCEL_CUSTOMER') return 'suspension';
  if (actionType === 'REACTIVATE_CUSTOMER') return 'reactivation';
  return null;
};

/** Tras APPROVED: encola órdenes reales y dispara worker si live. */
export async function applyApprovedProvisioningLive(action: ProvisioningAction, actor: string): Promise<void> {
  if (!productionGates.provisioningExecute()) return;

  const orderType = orderTypeForAction(action.actionType);
  if (!orderType) {
    logger.info('Provisioning live: acción sin orden de red directa', {
      actionId: action.id,
      actionType: action.actionType,
    });
    return;
  }

  await dispatchNetworkOrder({
    customerId: action.customerId,
    orderType,
    source: 'provisioning-center',
    reason: `Provisioning ${action.actionType} aprobado por ${actor}`,
    actor,
  });
}

/** Cambio administrativo de estado CRM tras provisioning live. */
export async function applyProvisioningCustomerStatus(action: ProvisioningAction): Promise<void> {
  if (!productionGates.provisioningExecute()) return;

  const customers = getCustomersService();
  if (action.actionType === 'SUSPEND_CUSTOMER' || action.actionType === 'CANCEL_CUSTOMER') {
    await customers.update(action.customerId, { status: 'suspended' });
  } else if (action.actionType === 'REACTIVATE_CUSTOMER') {
    await customers.update(action.customerId, { status: 'active' });
  }
}
