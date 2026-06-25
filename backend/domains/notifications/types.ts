// ====================================================================
// Notification Engine Foundation (PROD-9) — DRY RUN / MOCK PROVIDER.
//
// Motor central de notificaciones para Cobranza, NOC, Tickets, Automation,
// Provisioning, Service Status y Client 360. En esta fase NO envia mensajes
// reales: opera siempre en modo simulacion (dryRun=true, providers mock).
// No conecta APIs externas, no guarda tokens, no usa credenciales.
// ====================================================================

export const NOTIFICATION_TYPES = [
  'PAYMENT_REMINDER',
  'INVOICE_OVERDUE',
  'SERVICE_SUSPENSION_PENDING',
  'SERVICE_REACTIVATION_PENDING',
  'NOC_ALERT',
  'TICKET_UPDATE',
  'INSTALLATION_REMINDER',
  'PROVISIONING_STATUS',
  'SYSTEM_ALERT',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CHANNELS = [
  'WHATSAPP',
  'TELEGRAM',
  'EMAIL',
  'PUSH',
  'IN_APP',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// DRAFT → QUEUED → SIMULATED (nunca SENT real en esta fase). CANCELLED y
// FAILED son terminales. SENT existe en el tipo por contrato futuro pero el
// motor NUNCA lo asigna en PROD-9.
export const NOTIFICATION_STATUSES = [
  'DRAFT',
  'QUEUED',
  'SIMULATED',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// Variables soportadas por las plantillas (interpolacion {{var}}).
export const TEMPLATE_VARIABLES = [
  'customerName',
  'amount',
  'dueDate',
  'invoiceId',
  'serviceStatus',
  'ticketId',
  'routerName',
  'alertType',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export interface NotificationTemplate {
  id: string;
  type: NotificationType;
  name: string;
  channelDefault: NotificationChannel;
  body: string;
  variables: TemplateVariable[];
}

// Resultado de un provider mock. Nunca envia: solo describe que enviaria.
export interface ProviderPreviewResult {
  channel: NotificationChannel;
  provider: 'mock';
  dryRun: true;
  wouldSend: true;
  sent: false;
  renderedBody: string;
  note: string;
}

export interface NotificationMessage {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  customerId?: string;
  customerName?: string;
  templateId: string;
  renderedBody: string;
  variables: Record<string, string>;
  status: NotificationStatus;
  source: string;
  provider: 'mock';
  dryRun: true;
  sent: false;
  createdAt: string;
  updatedAt: string;
  simulationResult?: string;
  cancelReason?: string;
}

export interface NotificationAuditEntry {
  id: string;
  messageId: string;
  type: NotificationType;
  channel: NotificationChannel;
  customerId?: string;
  previousStatus: NotificationStatus | null;
  nextStatus: NotificationStatus;
  actor: string;
  dryRun: true;
  sent: false;
  createdAt: string;
}

export interface NotificationDetail {
  message: NotificationMessage;
  audit: NotificationAuditEntry[];
}

export interface PreviewInput {
  type?: unknown;
  channel?: unknown;
  customerId?: unknown;
  customerName?: unknown;
  variables?: unknown;
}

export interface PreviewResult {
  type: NotificationType;
  channel: NotificationChannel;
  templateId: string;
  renderedBody: string;
  variables: Record<string, string>;
  provider: 'mock';
  dryRun: true;
  wouldSend: true;
  sent: false;
}

export interface NotificationSummary {
  totalMessages: number;
  draft: number;
  queued: number;
  simulated: number;
  cancelled: number;
  failed: number;
  pending: number;
  supportedTypes: number;
  supportedChannels: number;
  templates: number;
  dryRun: true;
}
