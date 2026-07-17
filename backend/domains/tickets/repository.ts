// ====================================================================
// SupportRepository — tickets + work orders (USE_DB_SUPPORT).
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { TaskOrder, Ticket } from '../../../src/types';
import { store } from '../../state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import {
  belongsToTenant,
  dbErrorMessage,
  getTenantColumnReady,
  isMissingTenantIdColumnError,
  setTenantColumnReady,
  stripTenantIdIfUnsupported,
} from '../tenancy/tenant-scope';
import {
  TicketAttachmentRow,
  TicketHistoryRow,
  TicketMessageRow,
  TicketRow,
  WorkOrderRow,
  rowToTicket,
  rowToWorkOrder,
  ticketToRow,
  workOrderToRow,
} from './mappers';

const TICKETS_TABLE = 'tickets';
const WORK_ORDERS_TABLE = 'work_orders';

const throwDb = (context: string, error: unknown): never => {
  throw new Error(`Support DB error (${context}): ${dbErrorMessage(error)}`);
};
import type {
  SupportFilters,
  TicketCreateInput,
  TicketUpdateInput,
  WorkOrderCreateInput,
  WorkOrderUpdateInput,
} from './types';

export interface SupportRepository {
  listTechnicians(tenantId?: string): Promise<{ id: string; name: string }[]>;
  listTickets(filters: SupportFilters): Promise<Ticket[]>;
  getTicket(id: string, tenantId?: string): Promise<Ticket | null>;
  createTicket(input: TicketCreateInput): Promise<Ticket>;
  updateTicket(id: string, patch: TicketUpdateInput, tenantId?: string): Promise<Ticket | null>;
  deleteTicket(id: string, tenantId?: string): Promise<boolean>;
  assignTicket(id: string, technicianId?: string, technicianName?: string, tenantId?: string): Promise<Ticket | null>;
  setTicketStatus(id: string, status: Ticket['status'], tenantId?: string): Promise<Ticket | null>;
  addTicketMessage(id: string, message: string, sender?: string, tenantId?: string): Promise<Ticket | null>;
  addTicketAttachment(id: string, attachment: { name: string; url: string; type?: string; uploadedBy?: string }, tenantId?: string): Promise<Ticket | null>;
  getTicketHistory(id: string, tenantId?: string): Promise<NonNullable<Ticket['history']>>;
  generateTicketId(): Promise<string>;
  generateWorkOrderId(): Promise<string>;
  listWorkOrders(filters: SupportFilters): Promise<TaskOrder[]>;
  getWorkOrderAgenda(filters: { technicianId?: string; from?: string; to?: string; tenantId?: string }): Promise<{ date: string; count: number; workOrders: TaskOrder[] }[]>;
  getWorkOrder(id: string, tenantId?: string): Promise<TaskOrder | null>;
  createWorkOrder(input: WorkOrderCreateInput): Promise<TaskOrder>;
  updateWorkOrder(id: string, patch: WorkOrderUpdateInput, tenantId?: string): Promise<TaskOrder | null>;
  deleteWorkOrder(id: string, tenantId?: string): Promise<boolean>;
  toggleChecklistItem(id: string, index: number, tenantId?: string): Promise<TaskOrder | null>;
  updateWorkOrderStatus(id: string, status: TaskOrder['status'], tenantId?: string): Promise<TaskOrder | null>;
  addWorkOrderEvidence(id: string, evidence: { kind: string; url: string }, tenantId?: string): Promise<TaskOrder | null>;
}

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const appendTicketHistory = (ticket: Ticket, action: string, detail: string, createdBy?: string) => {
  ticket.history = ticket.history || [];
  ticket.history.unshift({
    id: 'th-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
    action,
    detail,
    createdAt: nowStamp(),
    createdBy,
  });
  ticket.updatedAt = nowStamp();
};

const appendWorkOrderHistory = (order: TaskOrder, action: string, detail: string, createdBy?: string) => {
  order.history = order.history || [];
  order.history.unshift({
    id: 'woh-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
    action,
    detail,
    createdAt: nowStamp(),
    createdBy,
  });
};

const updateRelatedClientOnCompletedOrder = (order: TaskOrder) => {
  const client = store.CLIENTS.find((c) => {
    if (c.id !== order.clientId) return false;
    if (!order.tenantId) return true;
    return belongsToTenant(c.tenantId, order.tenantId);
  });
  if (client && client.status === 'lead') {
    client.status = 'active';
    client.installationDate = new Date().toISOString().substring(0, 10);
    client.ip = `10.100.10.${Math.floor(Math.random() * 200) + 10}`;
    client.mac = `00:E0:4C:D1:A1:${Math.floor(Math.random() * 90) + 10}`;
    client.pppoeUser = `${client.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_nuga`;
    client.pppoePassword = 'DefaultSecurePassword';
    store.createAlert('client', 'info', client.name, 'Instalacion fisica concretada por Tecnico. Servicio activo.');
  }
};

const matchesTenant = (recordTenantId: string | undefined | null, tenantId?: string): boolean =>
  !tenantId || belongsToTenant(recordTenantId, tenantId);

export class StoreSupportRepository implements SupportRepository {
  async listTechnicians(tenantId?: string) {
    const byOrder = store.WORK_ORDERS
      .filter((wo) => matchesTenant(wo.tenantId, tenantId))
      .map((wo) => ({
        id: wo.assignedTechnicianId || wo.technicianName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: wo.technicianName,
      }));
    const byTicket = store.TICKETS
      .filter((tk) => !!tk.technicianName && matchesTenant(tk.tenantId, tenantId))
      .map((tk) => ({
        id: tk.technicianId || tk.technicianName!.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name: tk.technicianName!,
      }));
    const unique = new Map<string, { id: string; name: string }>();
    [...byOrder, ...byTicket].forEach((row) => {
      if (!unique.has(row.id)) unique.set(row.id, row);
    });
    return Array.from(unique.values());
  }

  async listTickets(filters: SupportFilters): Promise<Ticket[]> {
    const { status, severity, priority, technicianId, clientId, q, tenantId } = filters;
    return store.TICKETS.filter((ticket) => {
      const matchesTenantFilter = matchesTenant(ticket.tenantId, tenantId);
      const matchesStatus = !status || ticket.status === status;
      const matchesSeverity = !severity || ticket.severity === severity;
      const matchesPriority = !priority || ticket.priority === priority;
      const matchesTechnician = !technicianId || ticket.technicianId === technicianId;
      const matchesClient = !clientId || ticket.clientId === clientId;
      const matchesQ = !q
        || ticket.title.toLowerCase().includes(q)
        || ticket.clientName.toLowerCase().includes(q)
        || ticket.description.toLowerCase().includes(q);
      return matchesTenantFilter && matchesStatus && matchesSeverity && matchesPriority && matchesTechnician && matchesClient && matchesQ;
    });
  }

  async getTicket(id: string, tenantId?: string) {
    const ticket = store.TICKETS.find((t) => t.id === id) ?? null;
    if (!ticket || !matchesTenant(ticket.tenantId, tenantId)) return null;
    return ticket;
  }

  async createTicket(input: TicketCreateInput): Promise<Ticket> {
    const client = input.clientId
      ? store.CLIENTS.find((c) => c.id === input.clientId && matchesTenant(c.tenantId, input.tenantId))
      : undefined;
    const createdAt = nowStamp();
    const newTicket: Ticket = {
      id: await this.generateTicketId(),
      clientName: client ? client.name : input.clientName || 'Cliente Generico',
      clientId: input.clientId,
      tenantId: input.tenantId || 'tenant-default',
      title: input.title,
      description: input.description || 'Sin descripcion',
      category: input.category,
      severity: input.severity,
      priority: input.priority,
      status: 'open',
      slaHours: input.severity === 'critical' ? 1 : input.severity === 'high' ? 4 : 24,
      created: createdAt,
      updatedAt: createdAt,
      messages: input.description ? [{ sender: 'Cliente', message: input.description, date: createdAt }] : [],
      attachments: [],
      history: [],
    };
    appendTicketHistory(newTicket, 'created', `Ticket creado con prioridad ${newTicket.priority} y severidad ${newTicket.severity}.`, 'system');
    store.TICKETS.unshift(newTicket);
    store.createAlert('system', 'warning', newTicket.clientName, `Nuevo ticket soporte: ${input.title}`);
    return newTicket;
  }

  async updateTicket(id: string, patch: TicketUpdateInput, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    if (!ticket) return null;
    const changes: string[] = [];
    if (patch.title !== undefined) { ticket.title = patch.title; changes.push('titulo'); }
    if (patch.description !== undefined) { ticket.description = patch.description; changes.push('descripcion'); }
    if (patch.category !== undefined) { ticket.category = patch.category; changes.push('categoria'); }
    if (patch.severity !== undefined) {
      ticket.severity = patch.severity;
      ticket.slaHours = patch.severity === 'critical' ? 1 : patch.severity === 'high' ? 4 : 24;
      changes.push('severidad');
    }
    if (patch.priority !== undefined) { ticket.priority = patch.priority; changes.push('prioridad'); }
    if (patch.status !== undefined) { ticket.status = patch.status; changes.push('estado'); }
    if (patch.technicianId !== undefined) { ticket.technicianId = patch.technicianId; changes.push('tecnico_id'); }
    if (patch.technicianName !== undefined) { ticket.technicianName = patch.technicianName; changes.push('tecnico_nombre'); }
    if (changes.length > 0) appendTicketHistory(ticket, 'updated', `Campos actualizados: ${changes.join(', ')}.`, 'support');
    return ticket;
  }

  async deleteTicket(id: string, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    if (!ticket) return false;
    store.TICKETS = store.TICKETS.filter((t) => t.id !== id);
    return true;
  }

  async assignTicket(id: string, technicianId?: string, technicianName?: string, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    if (!ticket) return null;
    if (technicianId) ticket.technicianId = technicianId;
    if (technicianName) ticket.technicianName = technicianName;
    ticket.status = 'assigned';
    appendTicketHistory(ticket, 'assigned', `Ticket asignado a ${ticket.technicianName || ticket.technicianId}.`, 'support');
    return ticket;
  }

  async setTicketStatus(id: string, status: Ticket['status'], tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    if (!ticket) return null;
    ticket.status = status;
    appendTicketHistory(ticket, 'status_change', `Estado actualizado a ${status}.`, 'support');
    return ticket;
  }

  async addTicketMessage(id: string, message: string, sender?: string, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    if (!ticket) return null;
    ticket.messages.push({ sender: sender || 'Soporte NugaCore', message, date: nowStamp() });
    appendTicketHistory(ticket, 'comment', 'Nuevo comentario agregado al ticket.', sender || 'support');
    return ticket;
  }

  async addTicketAttachment(id: string, attachment: { name: string; url: string; type?: string; uploadedBy?: string }, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    if (!ticket) return null;
    ticket.attachments = ticket.attachments || [];
    ticket.attachments.unshift({
      id: 'att-' + Date.now() + '-' + Math.floor(Math.random() * 90 + 10),
      name: attachment.name,
      url: attachment.url,
      type: attachment.type,
      uploadedAt: nowStamp(),
      uploadedBy: attachment.uploadedBy,
    });
    appendTicketHistory(ticket, 'attachment', `Adjunto agregado: ${attachment.name}.`, attachment.uploadedBy || 'support');
    return ticket;
  }

  async getTicketHistory(id: string, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    return ticket?.history || [];
  }

  async generateTicketId() {
    return store.getUniqueTicketId();
  }

  async generateWorkOrderId() {
    return store.getUniqueWorkOrderId();
  }

  async listWorkOrders(filters: SupportFilters) {
    const { status, type, technicianId, dateFrom, dateTo, q, tenantId } = filters;
    return store.WORK_ORDERS.filter((order) => {
      const matchesTenantFilter = matchesTenant(order.tenantId, tenantId);
      const matchesStatus = !status || order.status === status;
      const matchesType = !type || order.type === type;
      const matchesTech = !technicianId || order.assignedTechnicianId === technicianId;
      const matchesFrom = !dateFrom || order.date >= dateFrom;
      const matchesTo = !dateTo || order.date <= dateTo;
      const matchesQ = !q
        || order.title.toLowerCase().includes(q)
        || order.clientName.toLowerCase().includes(q)
        || order.address.toLowerCase().includes(q)
        || order.technicianName.toLowerCase().includes(q);
      return matchesTenantFilter && matchesStatus && matchesType && matchesTech && matchesFrom && matchesTo && matchesQ;
    });
  }

  async getWorkOrderAgenda(filters: { technicianId?: string; from?: string; to?: string; tenantId?: string }) {
    const rows = store.WORK_ORDERS.filter((item) => {
      const matchesTenantFilter = matchesTenant(item.tenantId, filters.tenantId);
      const matchesTechnician = !filters.technicianId || item.assignedTechnicianId === filters.technicianId;
      const matchesFrom = !filters.from || item.date >= filters.from;
      const matchesTo = !filters.to || item.date <= filters.to;
      return matchesTenantFilter && matchesTechnician && matchesFrom && matchesTo;
    });
    const grouped = rows.reduce<Record<string, TaskOrder[]>>((acc, item) => {
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    }, {});
    return Object.keys(grouped).sort().map((date) => ({
      date,
      count: grouped[date].length,
      workOrders: grouped[date],
    }));
  }

  async getWorkOrder(id: string, tenantId?: string) {
    const order = store.WORK_ORDERS.find((o) => o.id === id) ?? null;
    if (!order || !matchesTenant(order.tenantId, tenantId)) return null;
    return order;
  }

  async createWorkOrder(input: WorkOrderCreateInput) {
    const client = store.CLIENTS.find((c) =>
      c.id === input.clientId && matchesTenant(c.tenantId, input.tenantId),
    );
    if (!client) throw new Error('Invalid clientId');
    const order: TaskOrder = {
      id: await this.generateWorkOrderId(),
      title: input.title,
      type: input.type,
      clientName: client.name,
      clientId: client.id,
      tenantId: input.tenantId || 'tenant-default',
      address: input.address ?? client.address,
      phone: input.phone ?? client.phone,
      notes: input.notes ?? 'Sin notas',
      date: input.date,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      assignedTechnicianId: input.assignedTechnicianId,
      technicianName: input.technicianName ?? 'Tecnico por asignar',
      status: input.status,
      checklist: input.checklist ?? [],
      photos: [],
      evidences: [],
      history: [],
    };
    appendWorkOrderHistory(order, 'created', `Orden de trabajo creada (${order.type}).`, 'support');
    store.WORK_ORDERS.unshift(order);
    return order;
  }

  async updateWorkOrder(id: string, patch: WorkOrderUpdateInput, tenantId?: string) {
    const order = await this.getWorkOrder(id, tenantId);
    if (!order) return null;
    if (patch.title !== undefined) order.title = patch.title;
    if (patch.type !== undefined) order.type = patch.type;
    if (patch.address !== undefined) order.address = patch.address;
    if (patch.phone !== undefined) order.phone = patch.phone;
    if (patch.notes !== undefined) order.notes = patch.notes;
    if (patch.date !== undefined) order.date = patch.date;
    if (patch.scheduledStart !== undefined) order.scheduledStart = patch.scheduledStart;
    if (patch.scheduledEnd !== undefined) order.scheduledEnd = patch.scheduledEnd;
    if (patch.assignedTechnicianId !== undefined) order.assignedTechnicianId = patch.assignedTechnicianId;
    if (patch.technicianName !== undefined) order.technicianName = patch.technicianName;
    if (patch.status !== undefined) {
      order.status = patch.status;
      if (patch.status === 'completed') updateRelatedClientOnCompletedOrder(order);
    }
    if (patch.checklist !== undefined) order.checklist = patch.checklist;
    appendWorkOrderHistory(order, 'updated', 'Orden de trabajo actualizada.', 'support');
    return order;
  }

  async deleteWorkOrder(id: string, tenantId?: string) {
    const order = await this.getWorkOrder(id, tenantId);
    if (!order) return false;
    store.WORK_ORDERS = store.WORK_ORDERS.filter((o) => o.id !== id);
    return true;
  }

  async toggleChecklistItem(id: string, index: number, tenantId?: string) {
    const order = await this.getWorkOrder(id, tenantId);
    if (!order || !order.checklist[index]) return null;
    order.checklist[index].done = !order.checklist[index].done;
    appendWorkOrderHistory(order, 'checklist', `Checklist item ${index + 1} toggled.`, 'technician');
    return order;
  }

  async updateWorkOrderStatus(id: string, status: TaskOrder['status'], tenantId?: string) {
    const order = await this.getWorkOrder(id, tenantId);
    if (!order) return null;
    order.status = status;
    if (status === 'completed') updateRelatedClientOnCompletedOrder(order);
    appendWorkOrderHistory(order, 'status_change', `Estado actualizado a ${status}.`, 'technician');
    return order;
  }

  async addWorkOrderEvidence(id: string, evidence: { kind: string; url: string }, tenantId?: string) {
    const order = await this.getWorkOrder(id, tenantId);
    if (!order) return null;
    order.evidences = order.evidences || [];
    order.evidences.unshift({
      id: 'ev-' + Date.now(),
      kind: evidence.kind as 'photo' | 'document',
      url: evidence.url,
      uploadedAt: nowStamp(),
    });
    appendWorkOrderHistory(order, 'evidence', 'Evidencia agregada.', 'technician');
    return order;
  }
}

// ── Supabase (tickets + work_orders desde init_schema) ───────────────

export class SupabaseSupportRepository implements SupportRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async hydrateTicket(row: TicketRow): Promise<Ticket> {
    const [messages, attachments, history] = await Promise.all([
      this.db.from('ticket_messages').select('*').eq('ticket_id', row.id).order('date', { ascending: true }),
      this.db.from('ticket_attachments').select('*').eq('ticket_id', row.id).order('uploaded_at', { ascending: false }),
      this.db.from('ticket_history').select('*').eq('ticket_id', row.id).order('created_at', { ascending: false }),
    ]);
    return rowToTicket(
      row,
      (messages.data ?? []) as TicketMessageRow[],
      (attachments.data ?? []) as TicketAttachmentRow[],
      (history.data ?? []) as TicketHistoryRow[],
    );
  }

  async listTechnicians(tenantId?: string) {
    return new StoreSupportRepository().listTechnicians(tenantId);
  }

  private shouldEqTenant(table: string, tenantId?: string): boolean {
    return Boolean(tenantId) && getTenantColumnReady(table) !== false;
  }

  private async selectTicketsRows(filters: SupportFilters, useTenantEq: boolean) {
    let query = this.db.from(TICKETS_TABLE).select('*');
    if (useTenantEq && filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.severity) query = query.eq('severity', filters.severity);
    if (filters.priority) query = query.eq('priority', filters.priority);
    if (filters.technicianId) query = query.eq('technician_id', filters.technicianId);
    if (filters.clientId) query = query.eq('client_id', filters.clientId);
    return query.order('created_at', { ascending: false });
  }

  async listTickets(filters: SupportFilters) {
    const useTenantEq = this.shouldEqTenant(TICKETS_TABLE, filters.tenantId);
    let { data, error } = await this.selectTicketsRows(filters, useTenantEq);
    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(TICKETS_TABLE, false);
      logger.warn('tickets.tenant_id ausente — fallback in-memory (aplicar migración 20260717050000)');
      ({ data, error } = await this.selectTicketsRows(filters, false));
    } else if (!error && useTenantEq) {
      setTenantColumnReady(TICKETS_TABLE, true);
    }
    if (error) throwDb('listTickets', error);

    let tickets = await Promise.all(((data ?? []) as TicketRow[]).map((r) => this.hydrateTicket(r)));
    if (filters.tenantId && getTenantColumnReady(TICKETS_TABLE) === false) {
      tickets = tickets.filter((t) => belongsToTenant(t.tenantId, filters.tenantId!));
    }
    if (!filters.q) return tickets;
    return tickets.filter((t) =>
      t.title.toLowerCase().includes(filters.q!)
      || t.clientName.toLowerCase().includes(filters.q!)
      || t.description.toLowerCase().includes(filters.q!),
    );
  }

  async getTicket(id: string, tenantId?: string) {
    const useTenantEq = this.shouldEqTenant(TICKETS_TABLE, tenantId);
    let query = this.db.from(TICKETS_TABLE).select('*').eq('id', id);
    if (useTenantEq) query = query.eq('tenant_id', tenantId!);
    let { data, error } = await query.maybeSingle();
    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(TICKETS_TABLE, false);
      ({ data, error } = await this.db.from(TICKETS_TABLE).select('*').eq('id', id).maybeSingle());
    } else if (!error && useTenantEq) {
      setTenantColumnReady(TICKETS_TABLE, true);
    }
    if (error) throwDb('getTicket', error);
    if (!data) return null;
    const ticket = await this.hydrateTicket(data as TicketRow);
    if (tenantId && !belongsToTenant(ticket.tenantId, tenantId)) return null;
    return ticket;
  }

  async createTicket(input: TicketCreateInput) {
    const storeRepo = new StoreSupportRepository();
    const id = await storeRepo.generateTicketId();
    const row = ticketToRow({
      id,
      clientId: input.clientId,
      clientName: input.clientName,
      tenantId: input.tenantId || 'tenant-default',
      title: input.title,
      description: input.description || 'Sin descripcion',
      category: input.category,
      severity: input.severity,
      priority: input.priority,
      status: 'open',
      slaHours: input.severity === 'critical' ? 1 : input.severity === 'high' ? 4 : 24,
      created: nowStamp(),
      messages: [],
      attachments: [],
      history: [],
    });
    let payload: Record<string, unknown> = stripTenantIdIfUnsupported(TICKETS_TABLE, { ...row });
    let { error } = await this.db.from(TICKETS_TABLE).insert(payload);
    if (error && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(TICKETS_TABLE, false);
      payload = stripTenantIdIfUnsupported(TICKETS_TABLE, { ...row });
      ({ error } = await this.db.from(TICKETS_TABLE).insert(payload));
    } else if (!error) {
      setTenantColumnReady(TICKETS_TABLE, true);
    }
    if (error) throwDb('createTicket', error);
    await this.db.from('ticket_history').insert({
      id: 'th-' + Date.now(),
      ticket_id: id,
      action: 'created',
      detail: `Ticket creado con prioridad ${input.priority}.`,
      created_by: 'system',
    });
    if (input.description) {
      await this.db.from('ticket_messages').insert({
        id: 'tm-' + Date.now(),
        ticket_id: id,
        sender: 'Cliente',
        message: input.description,
      });
    }
    return (await this.getTicket(id, input.tenantId))!;
  }

  async updateTicket(id: string, patch: TicketUpdateInput, tenantId?: string) {
    const existing = await this.getTicket(id, tenantId);
    if (!existing) return null;
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.category !== undefined) dbPatch.category = patch.category;
    if (patch.severity !== undefined) {
      dbPatch.severity = patch.severity;
      dbPatch.sla_hours = patch.severity === 'critical' ? 1 : patch.severity === 'high' ? 4 : 24;
    }
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.technicianId !== undefined) dbPatch.technician_id = patch.technicianId;
    if (patch.technicianName !== undefined) dbPatch.technician_name = patch.technicianName;
    const useTenantEq = this.shouldEqTenant(TICKETS_TABLE, tenantId);
    let query = this.db.from(TICKETS_TABLE).update(dbPatch).eq('id', id);
    if (useTenantEq) query = query.eq('tenant_id', tenantId!);
    let { error } = await query;
    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(TICKETS_TABLE, false);
      ({ error } = await this.db.from(TICKETS_TABLE).update(dbPatch).eq('id', id));
    }
    if (error) throwDb('updateTicket', error);
    return this.getTicket(id, tenantId);
  }

  async deleteTicket(id: string, tenantId?: string) {
    const existing = await this.getTicket(id, tenantId);
    if (!existing) return false;
    const { error, count } = await this.db.from(TICKETS_TABLE).delete({ count: 'exact' }).eq('id', id);
    if (error) throwDb('deleteTicket', error);
    return (count ?? 0) > 0;
  }

  async assignTicket(id: string, technicianId?: string, technicianName?: string, tenantId?: string) {
    return this.updateTicket(id, { technicianId, technicianName, status: 'assigned' }, tenantId);
  }

  async setTicketStatus(id: string, status: Ticket['status'], tenantId?: string) {
    return this.updateTicket(id, { status }, tenantId);
  }

  async addTicketMessage(id: string, message: string, sender?: string, tenantId?: string) {
    const existing = await this.getTicket(id, tenantId);
    if (!existing) return null;
    await this.db.from('ticket_messages').insert({
      id: 'tm-' + Date.now(),
      ticket_id: id,
      sender: sender || 'Soporte NugaCore',
      message,
    });
    return this.getTicket(id, tenantId);
  }

  async addTicketAttachment(id: string, attachment: { name: string; url: string; type?: string; uploadedBy?: string }, tenantId?: string) {
    const existing = await this.getTicket(id, tenantId);
    if (!existing) return null;
    await this.db.from('ticket_attachments').insert({
      id: 'att-' + Date.now(),
      ticket_id: id,
      name: attachment.name,
      url: attachment.url,
      type: attachment.type ?? null,
      uploaded_by: attachment.uploadedBy ?? null,
    });
    return this.getTicket(id, tenantId);
  }

  async getTicketHistory(id: string, tenantId?: string) {
    const ticket = await this.getTicket(id, tenantId);
    return ticket?.history ?? [];
  }

  async generateTicketId() {
    return new StoreSupportRepository().generateTicketId();
  }

  async generateWorkOrderId() {
    return new StoreSupportRepository().generateWorkOrderId();
  }

  private async selectWorkOrderRows(filters: SupportFilters, useTenantEq: boolean) {
    let query = this.db.from(WORK_ORDERS_TABLE).select('*');
    if (useTenantEq && filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.type) query = query.eq('type', filters.type);
    if (filters.technicianId) query = query.eq('assigned_technician_id', filters.technicianId);
    return query.order('date', { ascending: false });
  }

  async listWorkOrders(filters: SupportFilters) {
    const useTenantEq = this.shouldEqTenant(WORK_ORDERS_TABLE, filters.tenantId);
    let { data, error } = await this.selectWorkOrderRows(filters, useTenantEq);
    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(WORK_ORDERS_TABLE, false);
      logger.warn('work_orders.tenant_id ausente — fallback in-memory (aplicar migración 20260717050000)');
      ({ data, error } = await this.selectWorkOrderRows(filters, false));
    } else if (!error && useTenantEq) {
      setTenantColumnReady(WORK_ORDERS_TABLE, true);
    }
    if (error) throwDb('listWorkOrders', error);

    let orders = ((data ?? []) as WorkOrderRow[]).map(rowToWorkOrder);
    if (filters.tenantId && getTenantColumnReady(WORK_ORDERS_TABLE) === false) {
      orders = orders.filter((o) => belongsToTenant(o.tenantId, filters.tenantId!));
    }
    if (filters.dateFrom) orders = orders.filter((o) => o.date >= filters.dateFrom!);
    if (filters.dateTo) orders = orders.filter((o) => o.date <= filters.dateTo!);
    if (filters.q) {
      orders = orders.filter((o) =>
        o.title.toLowerCase().includes(filters.q!)
        || o.clientName.toLowerCase().includes(filters.q!),
      );
    }
    return orders;
  }

  async getWorkOrderAgenda(filters: { technicianId?: string; from?: string; to?: string; tenantId?: string }) {
    const orders = await this.listWorkOrders({
      technicianId: filters.technicianId,
      dateFrom: filters.from,
      dateTo: filters.to,
      tenantId: filters.tenantId,
    });
    const grouped = orders.reduce<Record<string, TaskOrder[]>>((acc, item) => {
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(item);
      return acc;
    }, {});
    return Object.keys(grouped).sort().map((date) => ({
      date,
      count: grouped[date].length,
      workOrders: grouped[date],
    }));
  }

  async getWorkOrder(id: string, tenantId?: string) {
    const useTenantEq = this.shouldEqTenant(WORK_ORDERS_TABLE, tenantId);
    let query = this.db.from(WORK_ORDERS_TABLE).select('*').eq('id', id);
    if (useTenantEq) query = query.eq('tenant_id', tenantId!);
    let { data, error } = await query.maybeSingle();
    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(WORK_ORDERS_TABLE, false);
      ({ data, error } = await this.db.from(WORK_ORDERS_TABLE).select('*').eq('id', id).maybeSingle());
    } else if (!error && useTenantEq) {
      setTenantColumnReady(WORK_ORDERS_TABLE, true);
    }
    if (error) throwDb('getWorkOrder', error);
    if (!data) return null;
    const order = rowToWorkOrder(data as WorkOrderRow);
    if (tenantId && !belongsToTenant(order.tenantId, tenantId)) return null;
    return order;
  }

  async createWorkOrder(input: WorkOrderCreateInput) {
    const id = await this.generateWorkOrderId();
    const row = workOrderToRow({
      id,
      title: input.title,
      type: input.type,
      clientId: input.clientId,
      clientName: input.clientName,
      tenantId: input.tenantId || 'tenant-default',
      address: input.address ?? '',
      phone: input.phone ?? '',
      notes: input.notes ?? '',
      date: input.date,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      assignedTechnicianId: input.assignedTechnicianId,
      technicianName: input.technicianName ?? 'Tecnico por asignar',
      status: input.status,
      checklist: input.checklist ?? [],
      photos: [],
      evidences: [],
      history: [],
    });
    let payload: Record<string, unknown> = stripTenantIdIfUnsupported(WORK_ORDERS_TABLE, { ...row });
    let { error } = await this.db.from(WORK_ORDERS_TABLE).insert(payload);
    if (error && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(WORK_ORDERS_TABLE, false);
      payload = stripTenantIdIfUnsupported(WORK_ORDERS_TABLE, { ...row });
      ({ error } = await this.db.from(WORK_ORDERS_TABLE).insert(payload));
    } else if (!error) {
      setTenantColumnReady(WORK_ORDERS_TABLE, true);
    }
    if (error) throwDb('createWorkOrder', error);
    return (await this.getWorkOrder(id, input.tenantId))!;
  }

  async updateWorkOrder(id: string, patch: WorkOrderUpdateInput, tenantId?: string) {
    const existing = await this.getWorkOrder(id, tenantId);
    if (!existing) return null;
    const dbPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.type !== undefined) dbPatch.type = patch.type;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.checklist !== undefined) dbPatch.checklist = patch.checklist;
    const useTenantEq = this.shouldEqTenant(WORK_ORDERS_TABLE, tenantId);
    let query = this.db.from(WORK_ORDERS_TABLE).update(dbPatch).eq('id', id);
    if (useTenantEq) query = query.eq('tenant_id', tenantId!);
    let { error } = await query;
    if (error && useTenantEq && isMissingTenantIdColumnError(error)) {
      setTenantColumnReady(WORK_ORDERS_TABLE, false);
      ({ error } = await this.db.from(WORK_ORDERS_TABLE).update(dbPatch).eq('id', id));
    }
    if (error) throwDb('updateWorkOrder', error);
    return this.getWorkOrder(id, tenantId);
  }

  async deleteWorkOrder(id: string, tenantId?: string) {
    const existing = await this.getWorkOrder(id, tenantId);
    if (!existing) return false;
    const { error, count } = await this.db.from(WORK_ORDERS_TABLE).delete({ count: 'exact' }).eq('id', id);
    if (error) throwDb('deleteWorkOrder', error);
    return (count ?? 0) > 0;
  }

  async toggleChecklistItem(id: string, index: number, tenantId?: string) {
    const order = await this.getWorkOrder(id, tenantId);
    if (!order || !order.checklist[index]) return null;
    order.checklist[index].done = !order.checklist[index].done;
    return this.updateWorkOrder(id, { checklist: order.checklist }, tenantId);
  }

  async updateWorkOrderStatus(id: string, status: TaskOrder['status'], tenantId?: string) {
    return this.updateWorkOrder(id, { status }, tenantId);
  }

  async addWorkOrderEvidence(id: string, evidence: { kind: string; url: string }, tenantId?: string) {
    const existing = await this.getWorkOrder(id, tenantId);
    if (!existing) return null;
    await this.db.from('work_order_evidences').insert({
      id: 'ev-' + Date.now(),
      work_order_id: id,
      kind: evidence.kind,
      url: evidence.url,
    });
    return this.getWorkOrder(id, tenantId);
  }
}

let cachedRepo: SupportRepository | null = null;

export function getSupportRepository(): SupportRepository {
  if (cachedRepo) return cachedRepo;
  if (isDomainOnDb('support') && isSupabaseAdminConfigured && supabaseAdmin) {
    logger.info('Support domain: persistencia = Supabase (USE_DB_SUPPORT=true)');
    cachedRepo = new SupabaseSupportRepository(supabaseAdmin);
  } else {
    logger.info('Support domain: persistencia = store en memoria (USE_DB_SUPPORT=false)');
    cachedRepo = new StoreSupportRepository();
  }
  return cachedRepo;
}

export function resetSupportRepository(): void {
  cachedRepo = null;
}
