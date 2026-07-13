// ====================================================================
// Ejecución gated de decisiones Automation (PROD-8 live).
// ====================================================================

import { logger } from '../../common/logger';
import { productionGates } from '../../config/production-gates';
import { dispatchNetworkOrder } from '../../bridges/network-order-dispatch';
import { evaluateCustomerById } from '../suspension/engine';
import { notificationService } from '../notifications/service';
import type { AutomationDecision, DecisionRecord } from './types';

export async function executeAutomationDecision(decision: DecisionRecord, actor: string): Promise<void> {
  if (!productionGates.automationExecute()) return;
  if (!decision.customerId) return;

  const customerId = decision.customerId;

  switch (decision.decision as AutomationDecision) {
    case 'REQUEST_SUSPENSION':
      await evaluateCustomerById(customerId, actor);
      break;
    case 'REQUEST_REACTIVATION': {
      await dispatchNetworkOrder({
        customerId,
        orderType: 'reactivation',
        source: 'engine',
        reason: `Automation: ${decision.ruleName}`,
        actor,
      });
      break;
    }
    case 'REQUEST_NOTIFICATION':
      notificationService.createMessage(
        {
          type: 'SYSTEM_ALERT',
          customerId,
          variables: { customerName: customerId, alert: decision.ruleName },
        },
        actor,
      );
      if (productionGates.notificationsLive()) {
        const messages = notificationService.messagesForCustomer(customerId);
        const latest = messages[messages.length - 1];
        if (latest) notificationService.simulateMessage(latest.id, actor);
      }
      break;
    default:
      logger.info('Automation live: decisión sin ejecutor directo', {
        decisionId: decision.id,
        decision: decision.decision,
      });
  }
}
