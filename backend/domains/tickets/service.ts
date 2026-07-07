// ====================================================================
// SupportService — tickets + work orders (USE_DB_SUPPORT).
// ====================================================================

import { TaskOrder, Ticket } from '../../../src/types';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { getCustomersService } from '../customers/service';
import { getSupportRepository } from './repository';
import type { SupportFilters, TicketCreateInput, TicketUpdateInput, WorkOrderCreateInput } from './types';

export const parseTicketStatus = (value: unknown): Ticket['status'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'open') return 'open';
  if (normalized === 'assigned') return 'assigned';
  if (normalized === 'resolved') return 'resolved';
  if (normalized === 'closed') return 'closed';
  return null;
};

export const parseTicketSeverity = (value: unknown): Ticket['severity'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'low') return 'low';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'high') return 'high';
  if (normalized === 'critical') return 'critical';
  return null;
};

export const parseTicketCategory = (value: unknown): Ticket['category'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'internet') return 'Internet';
  if (normalized === 'facturacion') return 'Facturacion';
  if (normalized === 'instalacion') return 'Instalacion';
  if (normalized === 'falla red') return 'Falla Red';
  if (normalized === 'otro') return 'Otro';
  return null;
};

export const parseTicketPriority = (value: unknown): NonNullable<Ticket['priority']> | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'P1') return 'P1';
  if (normalized === 'P2') return 'P2';
  if (normalized === 'P3') return 'P3';
  if (normalized === 'P4') return 'P4';
  return null;
};

export const priorityFromSeverity = (severity: Ticket['severity']): NonNullable<Ticket['priority']> => {
  if (severity === 'critical') return 'P1';
  if (severity === 'high') return 'P2';
  if (severity === 'medium') return 'P3';
  return 'P4';
};

export const parseWorkOrderStatus = (value: unknown): TaskOrder['status'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pending') return 'pending';
  if (normalized === 'in_progress') return 'in_progress';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'canceled') return 'canceled';
  return null;
};

export const parseWorkOrderType = (value: unknown): TaskOrder['type'] | null => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'installation') return 'installation';
  if (normalized === 'repair') return 'repair';
  if (normalized === 'migration') return 'migration';
  if (normalized === 'reallocation') return 'reallocation';
  return null;
};

export class SupportService {
  constructor(private readonly repo = getSupportRepository()) {}

  listTechnicians() {
    return this.repo.listTechnicians();
  }

  listTickets(query: Record<string, unknown>) {
    const filters: SupportFilters = {
      status: parseTicketStatus(query.status) ?? undefined,
      severity: parseTicketSeverity(query.severity) ?? undefined,
      priority: parseTicketPriority(query.priority) ?? undefined,
      technicianId: String(query.technicianId || '').trim() || undefined,
      clientId: String(query.clientId || '').trim() || undefined,
      q: String(query.q || '').trim().toLowerCase() || undefined,
    };
    return this.repo.listTickets(filters);
  }

  getTicket(id: string) {
    return this.repo.getTicket(id);
  }

  async createTicket(body: Record<string, unknown>) {
    const title = String(body.title || '').trim();
    if (!title) throw new BadRequestError('Missing required field: title', 'MISSING_FIELD');
    const clientId = body.clientId ? String(body.clientId) : undefined;
    const client = clientId ? await getCustomersService().getById(clientId) : null;
    const parsedSeverity = parseTicketSeverity(body.severity) || 'medium';
    const parsedCategory = parseTicketCategory(body.category) || 'Internet';
    const parsedPriority = parseTicketPriority(body.priority) || priorityFromSeverity(parsedSeverity);
    const input: TicketCreateInput = {
      clientId,
      clientName: client ? client.name : 'Cliente Generico',
      title,
      description: body.description ? String(body.description) : undefined,
      category: parsedCategory,
      severity: parsedSeverity,
      priority: parsedPriority,
    };
    return this.repo.createTicket(input);
  }

  async updateTicket(id: string, body: Record<string, unknown>) {
    const patch: TicketUpdateInput = {};
    if (body.title !== undefined) patch.title = String(body.title);
    if (body.description !== undefined) patch.description = String(body.description);
    if (body.category !== undefined) {
      const cat = parseTicketCategory(body.category);
      if (!cat) throw new BadRequestError('Invalid category', 'INVALID_ENUM');
      patch.category = cat;
    }
    if (body.severity !== undefined) {
      const sev = parseTicketSeverity(body.severity);
      if (!sev) throw new BadRequestError('Invalid severity', 'INVALID_ENUM');
      patch.severity = sev;
    }
    if (body.priority !== undefined) {
      const pri = parseTicketPriority(body.priority);
      if (!pri) throw new BadRequestError('Invalid priority', 'INVALID_ENUM');
      patch.priority = pri;
    }
    if (body.status !== undefined) {
      const st = parseTicketStatus(body.status);
      if (!st) throw new BadRequestError('Invalid status', 'INVALID_ENUM');
      patch.status = st;
    }
    if (body.technicianId !== undefined) patch.technicianId = String(body.technicianId || '');
    if (body.technicianName !== undefined) patch.technicianName = String(body.technicianName || '');
    const updated = await this.repo.updateTicket(id, patch);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  deleteTicket(id: string) {
    return this.repo.deleteTicket(id);
  }

  async assignTicket(id: string, body: Record<string, unknown>) {
    const technicianId = body.technicianId ? String(body.technicianId) : undefined;
    const technicianName = body.technicianName ? String(body.technicianName) : undefined;
    if (!technicianId && !technicianName) {
      throw new BadRequestError('Missing assignment data: technicianId or technicianName', 'MISSING_FIELD');
    }
    const updated = await this.repo.assignTicket(id, technicianId, technicianName);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  async setTicketStatus(id: string, body: Record<string, unknown>) {
    const status = parseTicketStatus(body.status);
    if (!status) throw new BadRequestError('Invalid status', 'INVALID_ENUM');
    const updated = await this.repo.setTicketStatus(id, status);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  async addTicketMessage(id: string, body: Record<string, unknown>) {
    const message = String(body.message || '').trim();
    if (!message) throw new BadRequestError('Missing required field: message', 'MISSING_FIELD');
    const updated = await this.repo.addTicketMessage(id, message, body.sender ? String(body.sender) : undefined);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  async addTicketAttachment(id: string, body: Record<string, unknown>) {
    const name = String(body.name || '').trim();
    const url = String(body.url || '').trim();
    if (!name || !url) throw new BadRequestError('Missing required fields: name, url', 'MISSING_FIELD');
    const updated = await this.repo.addTicketAttachment(id, {
      name,
      url,
      type: body.type ? String(body.type) : undefined,
      uploadedBy: body.uploadedBy ? String(body.uploadedBy) : undefined,
    });
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  getTicketHistory(id: string) {
    return this.repo.getTicketHistory(id);
  }

  listWorkOrders(query: Record<string, unknown>) {
    const filters: SupportFilters = {
      status: parseWorkOrderStatus(query.status) ?? undefined,
      type: parseWorkOrderType(query.type) ?? undefined,
      technicianId: String(query.technicianId || '').trim() || undefined,
      dateFrom: String(query.dateFrom || '').trim() || undefined,
      dateTo: String(query.dateTo || '').trim() || undefined,
      q: String(query.q || '').trim().toLowerCase() || undefined,
    };
    return this.repo.listWorkOrders(filters);
  }

  getWorkOrderAgenda(query: Record<string, unknown>) {
    return this.repo.getWorkOrderAgenda({
      technicianId: String(query.technicianId || '').trim() || undefined,
      from: String(query.from || '').trim() || undefined,
      to: String(query.to || '').trim() || undefined,
    });
  }

  getWorkOrder(id: string) {
    return this.repo.getWorkOrder(id);
  }

  async createWorkOrder(body: Record<string, unknown>) {
    const title = String(body.title || '').trim();
    const clientId = String(body.clientId || '').trim();
    const date = String(body.date || '').trim();
    if (!title || !clientId || !date) {
      throw new BadRequestError('Missing required fields: title, clientId, date', 'MISSING_FIELD');
    }
    const client = await getCustomersService().getById(clientId);
    if (!client) throw new BadRequestError('Invalid clientId', 'INVALID_REFERENCE');
    const input: WorkOrderCreateInput = {
      title,
      clientId,
      clientName: client.name,
      type: parseWorkOrderType(body.type) || 'repair',
      status: parseWorkOrderStatus(body.status) || 'pending',
      date,
      address: body.address ? String(body.address) : client.address,
      phone: body.phone ? String(body.phone) : client.phone,
      notes: body.notes ? String(body.notes) : undefined,
      scheduledStart: body.scheduledStart ? String(body.scheduledStart) : undefined,
      scheduledEnd: body.scheduledEnd ? String(body.scheduledEnd) : undefined,
      assignedTechnicianId: body.assignedTechnicianId ? String(body.assignedTechnicianId) : undefined,
      technicianName: body.technicianName ? String(body.technicianName) : undefined,
      checklist: Array.isArray(body.checklist)
        ? body.checklist.map((item: { item: unknown; done: unknown }) => ({
          item: String((item as { item: unknown }).item || 'Actividad'),
          done: !!(item as { done: unknown }).done,
        }))
        : [],
    };
    return this.repo.createWorkOrder(input);
  }

  async updateWorkOrder(id: string, body: Record<string, unknown>) {
    const patch: Record<string, unknown> = { ...body };
    if (body.type !== undefined) {
      const t = parseWorkOrderType(body.type);
      if (!t) throw new BadRequestError('Invalid work order type', 'INVALID_ENUM');
      patch.type = t;
    }
    if (body.status !== undefined) {
      const s = parseWorkOrderStatus(body.status);
      if (!s) throw new BadRequestError('Invalid work order status', 'INVALID_ENUM');
      patch.status = s;
    }
    const updated = await this.repo.updateWorkOrder(id, patch as import('./types').WorkOrderUpdateInput);
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }

  deleteWorkOrder(id: string) {
    return this.repo.deleteWorkOrder(id);
  }

  async toggleChecklistItem(id: string, index: number) {
    const updated = await this.repo.toggleChecklistItem(id, index);
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }

  async updateWorkOrderStatus(id: string, body: Record<string, unknown>) {
    const status = parseWorkOrderStatus(body.status);
    if (!status) throw new BadRequestError('Invalid status', 'INVALID_ENUM');
    const updated = await this.repo.updateWorkOrderStatus(id, status);
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }

  async addWorkOrderEvidence(id: string, body: Record<string, unknown>) {
    const url = String(body.url || '').trim();
    if (!url) throw new BadRequestError('Missing required field: url', 'MISSING_FIELD');
    const updated = await this.repo.addWorkOrderEvidence(id, {
      kind: body.kind ? String(body.kind) : 'photo',
      url,
    });
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }
}

let cached: SupportService | null = null;
export const getSupportService = (): SupportService => {
  if (!cached) cached = new SupportService();
  return cached;
};
export const resetSupportService = (): void => {
  cached = null;
};
