// ====================================================================
// Notifications audit (PROD-9 / FASE P).
//
// Registra cada transicion de estado de un mensaje: tipo, canal, estado
// previo/siguiente, actor, dryRun=true, sent=false y timestamp. Nunca
// registra secretos ni tokens.
// ====================================================================

import { nowIso } from '../../common/time';
import { notificationStore } from './store';
import {
  NotificationAuditEntry,
  NotificationMessage,
  NotificationStatus,
} from './types';

export const recordTransition = (
  message: NotificationMessage,
  previousStatus: NotificationStatus | null,
  nextStatus: NotificationStatus,
  actor: string,
): NotificationAuditEntry => {
  const entry: NotificationAuditEntry = {
    id: notificationStore.nextAuditId(),
    messageId: message.id,
    type: message.type,
    channel: message.channel,
    customerId: message.customerId,
    previousStatus,
    nextStatus,
    actor,
    dryRun: true,
    sent: false,
    createdAt: nowIso(),
  };
  return notificationStore.appendAudit(entry);
};

export const listAuditForMessage = (messageId: string): NotificationAuditEntry[] =>
  notificationStore.listAudit(messageId);

export const listAllAudit = (): NotificationAuditEntry[] => notificationStore.allAudit();
