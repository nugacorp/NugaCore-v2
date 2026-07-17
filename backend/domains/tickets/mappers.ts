import { TaskOrder, Ticket } from '../../../src/types';

export interface TicketRow {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  priority: string | null;
  status: string;
  sla_hours: number;
  technician_id: string | null;
  technician_name: string | null;
  tenant_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  sender: string;
  message: string;
  date: string;
}

export interface TicketAttachmentRow {
  id: string;
  ticket_id: string;
  name: string;
  url: string;
  type: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface TicketHistoryRow {
  id: string;
  ticket_id: string;
  action: string;
  detail: string | null;
  created_at: string;
  created_by: string | null;
}

export interface WorkOrderRow {
  id: string;
  title: string;
  type: string;
  client_id: string | null;
  client_name: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  assigned_technician_id: string | null;
  technician_name: string | null;
  status: string;
  checklist: unknown;
  signature: string | null;
  photos: unknown;
  tenant_id?: string | null;
  created_at: string;
}

const formatStamp = (iso: string): string =>
  iso.replace('T', ' ').substring(0, 16);

export const rowToTicket = (
  row: TicketRow,
  messages: TicketMessageRow[] = [],
  attachments: TicketAttachmentRow[] = [],
  history: TicketHistoryRow[] = [],
): Ticket => ({
  id: row.id,
  clientId: row.client_id ?? undefined,
  clientName: row.client_name,
  tenantId: row.tenant_id || 'tenant-default',
  title: row.title,
  description: row.description,
  category: row.category as Ticket['category'],
  severity: row.severity as Ticket['severity'],
  priority: (row.priority as Ticket['priority']) ?? undefined,
  status: row.status as Ticket['status'],
  slaHours: row.sla_hours,
  technicianId: row.technician_id ?? undefined,
  technicianName: row.technician_name ?? undefined,
  created: formatStamp(row.created_at),
  updatedAt: formatStamp(row.updated_at),
  messages: messages.map((m) => ({
    sender: m.sender,
    message: m.message,
    date: formatStamp(m.date),
  })),
  attachments: attachments.map((a) => ({
    id: a.id,
    name: a.name,
    url: a.url,
    type: a.type ?? undefined,
    uploadedAt: formatStamp(a.uploaded_at),
    uploadedBy: a.uploaded_by ?? undefined,
  })),
  history: history.map((h) => ({
    id: h.id,
    action: h.action,
    detail: h.detail ?? '',
    createdAt: formatStamp(h.created_at),
    createdBy: h.created_by ?? undefined,
  })),
});

export const ticketToRow = (ticket: Ticket): TicketRow => ({
  id: ticket.id,
  client_id: ticket.clientId ?? null,
  client_name: ticket.clientName,
  title: ticket.title,
  description: ticket.description,
  category: ticket.category,
  severity: ticket.severity,
  priority: ticket.priority ?? null,
  status: ticket.status,
  sla_hours: ticket.slaHours,
  technician_id: ticket.technicianId ?? null,
  technician_name: ticket.technicianName ?? null,
  tenant_id: ticket.tenantId || 'tenant-default',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

export const rowToWorkOrder = (row: WorkOrderRow): TaskOrder => ({
  id: row.id,
  title: row.title,
  type: row.type as TaskOrder['type'],
  clientId: row.client_id ?? '',
  clientName: row.client_name,
  tenantId: row.tenant_id || 'tenant-default',
  address: row.address ?? '',
  phone: row.phone ?? '',
  notes: row.notes ?? '',
  date: row.date ?? '',
  scheduledStart: row.scheduled_start ?? undefined,
  scheduledEnd: row.scheduled_end ?? undefined,
  assignedTechnicianId: row.assigned_technician_id ?? undefined,
  technicianName: row.technician_name ?? '',
  status: row.status as TaskOrder['status'],
  checklist: Array.isArray(row.checklist)
    ? (row.checklist as { item: string; done: boolean }[])
    : [],
  signature: row.signature ?? undefined,
  photos: Array.isArray(row.photos) ? (row.photos as string[]) : [],
  evidences: [],
  history: [],
});

export const workOrderToRow = (order: TaskOrder): WorkOrderRow => ({
  id: order.id,
  title: order.title,
  type: order.type,
  client_id: order.clientId,
  client_name: order.clientName,
  address: order.address,
  phone: order.phone,
  notes: order.notes,
  date: order.date,
  scheduled_start: order.scheduledStart ?? null,
  scheduled_end: order.scheduledEnd ?? null,
  assigned_technician_id: order.assignedTechnicianId ?? null,
  technician_name: order.technicianName,
  status: order.status,
  checklist: order.checklist,
  signature: order.signature ?? null,
  photos: order.photos ?? [],
  tenant_id: order.tenantId || 'tenant-default',
  created_at: new Date().toISOString(),
});
