// ====================================================================
// Automation → Notifications bridge (PROD-8 → PROD-9).
//
// Convierte decisiones pendientes del Automation Engine en previews /
// mensajes DRY-RUN del Notification Engine. Nunca envía mensajes reales.
// ====================================================================

import { BadRequestError, NotFoundError } from '../../common/errors';
import { notificationService } from '../notifications/service';
import type { NotificationType } from '../notifications/types';
import { automationService } from './service';
import type { AutomationDecision, DecisionRecord } from './types';

const DECISION_TO_TYPE: Partial<Record<AutomationDecision, NotificationType>> = {
  REQUEST_SUSPENSION: 'SERVICE_SUSPENSION_PENDING',
  REQUEST_REACTIVATION: 'SERVICE_REACTIVATION_PENDING',
  REQUEST_NOTIFICATION: 'PAYMENT_REMINDER',
};

const EVENT_TO_TYPE: Partial<Record<string, NotificationType>> = {
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  TICKET_CREATED: 'TICKET_UPDATE',
  TICKET_CLOSED: 'TICKET_UPDATE',
  NOC_ALERT: 'NOC_ALERT',
  INSTALLATION_COMPLETED: 'INSTALLATION_REMINDER',
};

const resolveNotificationType = (decision: DecisionRecord): NotificationType | null =>
  DECISION_TO_TYPE[decision.decision] ?? EVENT_TO_TYPE[decision.event] ?? null;

export const automationNotifyBridge = {
  previewFromDecision(decisionId: string, actor: string) {
    const decision = automationService.listDecisions().find((d) => d.id === decisionId);
    if (!decision) throw new NotFoundError('Decisión no encontrada.', 'DECISION_NOT_FOUND');

    const type = resolveNotificationType(decision);
    if (!type) {
      throw new BadRequestError(
        `La decisión ${decision.decision} no tiene plantilla de notificación asociada.`,
        'NO_NOTIFICATION_MAPPING',
      );
    }

    const variables: Record<string, string> = {
      customerName: decision.customerId ?? 'Cliente',
      serviceStatus: 'pendiente',
      ticketId: '—',
      alertType: decision.event,
      routerName: '—',
    };

    const preview = notificationService.preview({
      type,
      customerId: decision.customerId,
      variables,
    });

    const message = notificationService.createMessage(
      { type, customerId: decision.customerId, variables },
      actor,
      'automation',
    );

    return {
      decisionId: decision.id,
      decision: decision.decision,
      event: decision.event,
      preview,
      message,
      dryRun: true,
    };
  },

  processPendingDecisions(actor: string, limit = 20) {
    const pending = automationService
      .listDecisions()
      .filter((d) => d.status === 'PENDING' && resolveNotificationType(d) !== null)
      .slice(0, limit);

    const results = pending.map((d) => {
      try {
        return this.previewFromDecision(d.id, actor);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return {
      processed: results.length,
      dryRun: true,
      results,
    };
  },
};
