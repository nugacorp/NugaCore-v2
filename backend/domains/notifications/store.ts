// ====================================================================
// Notifications in-memory store (PROD-9).
//
// Almacena mensajes simulados y su bitacora. Solo almacenamiento descriptivo:
// ninguna entrada dispara entrega real (todo dryRun=true, sent=false).
// ====================================================================

import {
  NotificationAuditEntry,
  NotificationMessage,
  NotificationStatus,
} from './types';

const MESSAGES: NotificationMessage[] = [];
const AUDIT: NotificationAuditEntry[] = [];
let messageCounter = 0;
let auditCounter = 0;

const nextMessageId = (): string => {
  messageCounter += 1;
  return `notif-${messageCounter}`;
};

const nextAuditId = (): string => {
  auditCounter += 1;
  return `notif-audit-${auditCounter}`;
};

const count = (status: NotificationStatus): number =>
  MESSAGES.filter((item) => item.status === status).length;

export const notificationStore = {
  create(message: NotificationMessage): NotificationMessage {
    MESSAGES.unshift(message);
    return message;
  },

  list(): NotificationMessage[] {
    return [...MESSAGES];
  },

  getById(id: string): NotificationMessage | undefined {
    return MESSAGES.find((item) => item.id === id);
  },

  forCustomer(customerId: string): NotificationMessage[] {
    return MESSAGES.filter((item) => item.customerId === customerId);
  },

  update(id: string, patch: Partial<NotificationMessage>): NotificationMessage | undefined {
    const index = MESSAGES.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    MESSAGES[index] = { ...MESSAGES[index], ...patch };
    return MESSAGES[index];
  },

  appendAudit(entry: NotificationAuditEntry): NotificationAuditEntry {
    AUDIT.unshift(entry);
    return entry;
  },

  listAudit(messageId: string): NotificationAuditEntry[] {
    return AUDIT.filter((item) => item.messageId === messageId);
  },

  allAudit(): NotificationAuditEntry[] {
    return [...AUDIT];
  },

  counts() {
    return {
      total: MESSAGES.length,
      draft: count('DRAFT'),
      queued: count('QUEUED'),
      simulated: count('SIMULATED'),
      cancelled: count('CANCELLED'),
      failed: count('FAILED'),
    };
  },

  // Pendientes = DRAFT + QUEUED + SIMULATED (no cuenta CANCELLED ni FAILED).
  pendingCount(): number {
    return count('DRAFT') + count('QUEUED') + count('SIMULATED');
  },

  nextMessageId,
  nextAuditId,

  clearForTests(): void {
    MESSAGES.length = 0;
    AUDIT.length = 0;
    messageCounter = 0;
    auditCounter = 0;
  },
};
