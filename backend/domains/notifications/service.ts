// ====================================================================
// Notifications service (PROD-9) — orquestacion DRY RUN.
//
// Genera previews y mensajes simulados a partir de plantillas. NUNCA entrega
// nada real: todos los mensajes terminan en DRAFT/QUEUED/SIMULATED/CANCELLED,
// con dryRun=true y sent=false. No hay metodo de envio ni de despacho real.
// ====================================================================

import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors';
import { sanitizeText } from '../../common/security/sanitize-sensitive-data';
import { nowIso } from '../../common/time';
import { recordTransition } from './audit';
import { providerForChannel } from './providers';
import { notificationStore } from './store';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NotificationChannel,
  NotificationDetail,
  NotificationMessage,
  NotificationSummary,
  NotificationTemplate,
  NotificationType,
  PreviewInput,
  PreviewResult,
  TemplateVariable,
} from './types';

// ── Plantillas iniciales (FASE G) ──────────────────────────────────────
const TEMPLATES: NotificationTemplate[] = [
  {
    id: 'tpl-payment-reminder',
    type: 'PAYMENT_REMINDER',
    name: 'Recordatorio de pago',
    channelDefault: 'WHATSAPP',
    body: 'Hola {{customerName}}, te recordamos tu pago de {{amount}} con vencimiento {{dueDate}} (factura {{invoiceId}}).',
    variables: ['customerName', 'amount', 'dueDate', 'invoiceId'],
  },
  {
    id: 'tpl-invoice-overdue',
    type: 'INVOICE_OVERDUE',
    name: 'Factura vencida',
    channelDefault: 'WHATSAPP',
    body: 'Hola {{customerName}}, tu factura {{invoiceId}} por {{amount}} venció el {{dueDate}}. Regulariza para evitar suspensión.',
    variables: ['customerName', 'amount', 'dueDate', 'invoiceId'],
  },
  {
    id: 'tpl-suspension-pending',
    type: 'SERVICE_SUSPENSION_PENDING',
    name: 'Suspensión pendiente',
    channelDefault: 'WHATSAPP',
    body: 'Hola {{customerName}}, tu servicio está en estado {{serviceStatus}} con suspensión pendiente por adeudo.',
    variables: ['customerName', 'serviceStatus'],
  },
  {
    id: 'tpl-reactivation-pending',
    type: 'SERVICE_REACTIVATION_PENDING',
    name: 'Reactivación pendiente',
    channelDefault: 'WHATSAPP',
    body: 'Hola {{customerName}}, registramos tu pago. Tu servicio pasará a {{serviceStatus}} (reactivación pendiente).',
    variables: ['customerName', 'serviceStatus'],
  },
  {
    id: 'tpl-noc-alert',
    type: 'NOC_ALERT',
    name: 'Alerta NOC',
    channelDefault: 'IN_APP',
    body: 'Alerta de red ({{alertType}}) detectada en {{routerName}}. Revisión operativa sugerida.',
    variables: ['alertType', 'routerName'],
  },
  {
    id: 'tpl-ticket-update',
    type: 'TICKET_UPDATE',
    name: 'Ticket actualizado',
    channelDefault: 'EMAIL',
    body: 'Hola {{customerName}}, tu ticket {{ticketId}} fue actualizado. Te mantendremos informado.',
    variables: ['customerName', 'ticketId'],
  },
  {
    id: 'tpl-installation-reminder',
    type: 'INSTALLATION_REMINDER',
    name: 'Instalación programada',
    channelDefault: 'WHATSAPP',
    body: 'Hola {{customerName}}, tu instalación está programada para {{dueDate}}. Te visitaremos en ese horario.',
    variables: ['customerName', 'dueDate'],
  },
  {
    id: 'tpl-provisioning-status',
    type: 'PROVISIONING_STATUS',
    name: 'Estado de aprovisionamiento',
    channelDefault: 'IN_APP',
    body: 'Actualización de aprovisionamiento para {{customerName}}: estado {{serviceStatus}} en {{routerName}}.',
    variables: ['customerName', 'serviceStatus', 'routerName'],
  },
];

const templateForType = (type: NotificationType): NotificationTemplate => {
  const tpl = TEMPLATES.find((item) => item.type === type);
  if (!tpl) throw new BadRequestError(`Sin plantilla para tipo ${type}`, 'TEMPLATE_NOT_FOUND');
  return tpl;
};

const normalizeType = (value: unknown): NotificationType => {
  if (typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value)) {
    return value as NotificationType;
  }
  throw new BadRequestError(`type invalido. Permitidos: ${NOTIFICATION_TYPES.join(', ')}`, 'INVALID_TYPE');
};

const normalizeChannel = (value: unknown, fallback: NotificationChannel): NotificationChannel => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string' && (NOTIFICATION_CHANNELS as readonly string[]).includes(value)) {
    return value as NotificationChannel;
  }
  throw new BadRequestError(`channel invalido. Permitidos: ${NOTIFICATION_CHANNELS.join(', ')}`, 'INVALID_CHANNEL');
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? sanitizeText(value.trim()) : undefined;

const normalizeVariables = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue;
    out[key] = sanitizeText(String(raw));
  }
  return out;
};

// Interpola {{var}} de forma segura. Variables faltantes quedan como '—'.
const render = (template: NotificationTemplate, variables: Record<string, string>): string =>
  template.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value !== undefined && value !== '' ? value : '—';
  });

const buildPreview = (input: PreviewInput): {
  type: NotificationType;
  channel: NotificationChannel;
  template: NotificationTemplate;
  variables: Record<string, string>;
  renderedBody: string;
} => {
  const type = normalizeType(input.type);
  const template = templateForType(type);
  const channel = normalizeChannel(input.channel, template.channelDefault);
  const variables = normalizeVariables(input.variables);
  const customerName = optionalString(input.customerName);
  if (customerName && variables.customerName === undefined) variables.customerName = customerName;
  const renderedBody = render(template, variables);
  return { type, channel, template, variables, renderedBody };
};

export const notificationService = {
  listTemplates(): NotificationTemplate[] {
    return [...TEMPLATES];
  },

  listMessages(): NotificationMessage[] {
    return notificationStore.list();
  },

  messagesForCustomer(customerId: string): NotificationMessage[] {
    return notificationStore.forCustomer(customerId);
  },

  getMessage(id: string): NotificationDetail {
    const message = notificationStore.getById(id);
    if (!message) throw new NotFoundError('Notificación no encontrada.', 'NOTIFICATION_NOT_FOUND');
    return { message, audit: notificationStore.listAudit(id) };
  },

  // Vista previa pura: NO persiste. Pasa por el provider mock (wouldSend/sent).
  preview(input: PreviewInput): PreviewResult {
    const { type, channel, template, variables, renderedBody } = buildPreview(input);
    const providerResult = providerForChannel(channel).preview(renderedBody);
    return {
      type,
      channel,
      templateId: template.id,
      renderedBody: providerResult.renderedBody,
      variables,
      provider: 'mock',
      dryRun: true,
      wouldSend: true,
      sent: false,
    };
  },

  // Crea un mensaje en estado DRAFT (dry-run). No entrega nada.
  createMessage(input: PreviewInput, actor: string, source = 'manual'): NotificationMessage {
    const { type, channel, template, variables, renderedBody } = buildPreview(input);
    const createdAt = nowIso();
    const message: NotificationMessage = {
      id: notificationStore.nextMessageId(),
      type,
      channel,
      customerId: optionalString(input.customerId),
      customerName: variables.customerName ?? optionalString(input.customerName),
      templateId: template.id,
      renderedBody,
      variables,
      status: 'DRAFT',
      source: sanitizeText(source),
      provider: 'mock',
      dryRun: true,
      sent: false,
      createdAt,
      updatedAt: createdAt,
    };
    notificationStore.create(message);
    recordTransition(message, null, 'DRAFT', actor);
    return message;
  },

  // Simula la entrega: DRAFT/QUEUED → SIMULATED. NUNCA marca SENT real.
  simulateMessage(id: string, actor: string): NotificationMessage {
    const message = notificationStore.getById(id);
    if (!message) throw new NotFoundError('Notificación no encontrada.', 'NOTIFICATION_NOT_FOUND');
    if (!['DRAFT', 'QUEUED'].includes(message.status)) {
      throw new ConflictError(`No se puede simular en estado ${message.status}.`, 'INVALID_TRANSITION');
    }
    const providerResult = providerForChannel(message.channel).preview(message.renderedBody);
    const previousStatus = message.status;
    const updated = notificationStore.update(id, {
      status: 'SIMULATED',
      updatedAt: nowIso(),
      sent: false,
      simulationResult: `${providerResult.provider}: wouldSend=true, sent=false (dry-run).`,
    });
    if (!updated) throw new NotFoundError('Notificación no encontrada.', 'NOTIFICATION_NOT_FOUND');
    recordTransition(updated, previousStatus, 'SIMULATED', actor);
    return updated;
  },

  cancelMessage(id: string, actor: string, reason?: unknown): NotificationMessage {
    const message = notificationStore.getById(id);
    if (!message) throw new NotFoundError('Notificación no encontrada.', 'NOTIFICATION_NOT_FOUND');
    if (message.status === 'CANCELLED') {
      throw new ConflictError('La notificación ya está cancelada.', 'INVALID_TRANSITION');
    }
    const previousStatus = message.status;
    const updated = notificationStore.update(id, {
      status: 'CANCELLED',
      updatedAt: nowIso(),
      cancelReason: optionalString(reason),
    });
    if (!updated) throw new NotFoundError('Notificación no encontrada.', 'NOTIFICATION_NOT_FOUND');
    recordTransition(updated, previousStatus, 'CANCELLED', actor);
    return updated;
  },

  pendingCount(): number {
    return notificationStore.pendingCount();
  },

  summary(): NotificationSummary {
    const c = notificationStore.counts();
    return {
      totalMessages: c.total,
      draft: c.draft,
      queued: c.queued,
      simulated: c.simulated,
      cancelled: c.cancelled,
      failed: c.failed,
      pending: notificationStore.pendingCount(),
      supportedTypes: NOTIFICATION_TYPES.length,
      supportedChannels: NOTIFICATION_CHANNELS.length,
      templates: TEMPLATES.length,
      dryRun: true,
    };
  },
};

// Reexport para integraciones (Automation/Billing/NOC) que construyen previews.
export type { TemplateVariable };
