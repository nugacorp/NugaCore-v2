// ====================================================================
// SupportService — tickets + work orders (USE_DB_SUPPORT).
// ====================================================================

import { FtthWorkOrderFields, TaskOrder, Ticket } from '../../../src/types';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { getCustomersService } from '../customers/service';
import {
  FtthChecklistError,
  parseFtthFields,
  parseWorkOrderTechnology,
  validateFtthCompletion,
} from './ftth-checklist';
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

  listTechnicians(tenantId?: string) {
    return this.repo.listTechnicians(tenantId);
  }

  listTickets(query: Record<string, unknown>, tenantId?: string) {
    const effectiveTenantId = tenantId
      || (typeof query.tenantId === 'string' && query.tenantId.trim() ? query.tenantId.trim() : undefined);
    const filters: SupportFilters = {
      status: parseTicketStatus(query.status) ?? undefined,
      severity: parseTicketSeverity(query.severity) ?? undefined,
      priority: parseTicketPriority(query.priority) ?? undefined,
      technicianId: String(query.technicianId || '').trim() || undefined,
      clientId: String(query.clientId || '').trim() || undefined,
      q: String(query.q || '').trim().toLowerCase() || undefined,
      tenantId: effectiveTenantId,
    };
    return this.repo.listTickets(filters);
  }

  getTicket(id: string, tenantId?: string) {
    return this.repo.getTicket(id, tenantId);
  }

  async createTicket(body: Record<string, unknown>, tenantId?: string) {
    const title = String(body.title || '').trim();
    if (!title) throw new BadRequestError('Missing required field: title', 'MISSING_FIELD');
    const clientId = body.clientId ? String(body.clientId) : undefined;
    const client = clientId ? await getCustomersService().getById(clientId, tenantId) : null;
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
      tenantId,
    };
    return this.repo.createTicket(input);
  }

  async updateTicket(id: string, body: Record<string, unknown>, tenantId?: string) {
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
    const updated = await this.repo.updateTicket(id, patch, tenantId);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  deleteTicket(id: string, tenantId?: string) {
    return this.repo.deleteTicket(id, tenantId);
  }

  async assignTicket(id: string, body: Record<string, unknown>, tenantId?: string) {
    const technicianId = body.technicianId ? String(body.technicianId) : undefined;
    const technicianName = body.technicianName ? String(body.technicianName) : undefined;
    if (!technicianId && !technicianName) {
      throw new BadRequestError('Missing assignment data: technicianId or technicianName', 'MISSING_FIELD');
    }
    const updated = await this.repo.assignTicket(id, technicianId, technicianName, tenantId);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  async setTicketStatus(id: string, body: Record<string, unknown>, tenantId?: string) {
    const status = parseTicketStatus(body.status);
    if (!status) throw new BadRequestError('Invalid status', 'INVALID_ENUM');
    const updated = await this.repo.setTicketStatus(id, status, tenantId);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  async addTicketMessage(id: string, body: Record<string, unknown>, tenantId?: string) {
    const message = String(body.message || '').trim();
    if (!message) throw new BadRequestError('Missing required field: message', 'MISSING_FIELD');
    const updated = await this.repo.addTicketMessage(id, message, body.sender ? String(body.sender) : undefined, tenantId);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  async addTicketAttachment(id: string, body: Record<string, unknown>, tenantId?: string) {
    const name = String(body.name || '').trim();
    const url = String(body.url || '').trim();
    if (!name || !url) throw new BadRequestError('Missing required fields: name, url', 'MISSING_FIELD');
    const updated = await this.repo.addTicketAttachment(id, {
      name,
      url,
      type: body.type ? String(body.type) : undefined,
      uploadedBy: body.uploadedBy ? String(body.uploadedBy) : undefined,
    }, tenantId);
    if (!updated) throw new NotFoundError('Ticket not found', 'NOT_FOUND');
    return updated;
  }

  getTicketHistory(id: string, tenantId?: string) {
    return this.repo.getTicketHistory(id, tenantId);
  }

  listWorkOrders(query: Record<string, unknown>, tenantId?: string) {
    const effectiveTenantId = tenantId
      || (typeof query.tenantId === 'string' && query.tenantId.trim() ? query.tenantId.trim() : undefined);
    const filters: SupportFilters = {
      status: parseWorkOrderStatus(query.status) ?? undefined,
      type: parseWorkOrderType(query.type) ?? undefined,
      technicianId: String(query.technicianId || '').trim() || undefined,
      dateFrom: String(query.dateFrom || '').trim() || undefined,
      dateTo: String(query.dateTo || '').trim() || undefined,
      q: String(query.q || '').trim().toLowerCase() || undefined,
      tenantId: effectiveTenantId,
    };
    return this.repo.listWorkOrders(filters);
  }

  getWorkOrderAgenda(query: Record<string, unknown>, tenantId?: string) {
    const effectiveTenantId = tenantId
      || (typeof query.tenantId === 'string' && query.tenantId.trim() ? query.tenantId.trim() : undefined);
    return this.repo.getWorkOrderAgenda({
      technicianId: String(query.technicianId || '').trim() || undefined,
      from: String(query.from || '').trim() || undefined,
      to: String(query.to || '').trim() || undefined,
      tenantId: effectiveTenantId,
    });
  }

  getWorkOrder(id: string, tenantId?: string) {
    return this.repo.getWorkOrder(id, tenantId);
  }

  async createWorkOrder(body: Record<string, unknown>, tenantId?: string) {
    const title = String(body.title || '').trim();
    const clientId = String(body.clientId || '').trim();
    const date = String(body.date || '').trim();
    if (!title || !clientId || !date) {
      throw new BadRequestError('Missing required fields: title, clientId, date', 'MISSING_FIELD');
    }
    const client = await getCustomersService().getById(clientId, tenantId);
    if (!client) throw new BadRequestError('Invalid clientId', 'INVALID_REFERENCE');
    const technology = body.technology === undefined
      ? undefined
      : parseWorkOrderTechnology(body.technology);
    if (body.technology !== undefined && !technology) {
      throw new BadRequestError('Invalid work order technology', 'INVALID_ENUM');
    }
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
      technology: technology ?? undefined,
      ftth: parseFtthFields(body.ftth),
      tenantId,
    };
    // Crear una orden ya cerrada también pasa por el gate de entrega FTTH.
    if (input.status === 'completed') {
      const result = validateFtthCompletion({ technology: input.technology, ftth: input.ftth });
      if (!result.ok) throw new FtthChecklistError(result);
    }
    return this.repo.createWorkOrder(input);
  }

  async updateWorkOrder(id: string, body: Record<string, unknown>, tenantId?: string) {
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
    if (body.technology !== undefined) {
      const tech = parseWorkOrderTechnology(body.technology);
      if (!tech) throw new BadRequestError('Invalid work order technology', 'INVALID_ENUM');
      patch.technology = tech;
    }
    if (body.ftth !== undefined) patch.ftth = parseFtthFields(body.ftth);

    if (patch.status === 'completed') {
      const current = await this.repo.getWorkOrder(id, tenantId);
      if (!current) throw new NotFoundError('Work order not found', 'NOT_FOUND');
      this.assertFtthCompletionAllowed(current, patch);
    }

    const updated = await this.repo.updateWorkOrder(id, patch as import('./types').WorkOrderUpdateInput, tenantId);
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }

  deleteWorkOrder(id: string, tenantId?: string) {
    return this.repo.deleteWorkOrder(id, tenantId);
  }

  async toggleChecklistItem(id: string, index: number, tenantId?: string) {
    const updated = await this.repo.toggleChecklistItem(id, index, tenantId);
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }

  async updateWorkOrderStatus(id: string, body: Record<string, unknown>, tenantId?: string) {
    const status = parseWorkOrderStatus(body.status);
    if (!status) throw new BadRequestError('Invalid status', 'INVALID_ENUM');

    if (status === 'completed') {
      const current = await this.repo.getWorkOrder(id, tenantId);
      if (!current) throw new NotFoundError('Work order not found', 'NOT_FOUND');
      // El técnico puede mandar la captura FTTH en el mismo cierre.
      const ftth = body.ftth !== undefined ? parseFtthFields(body.ftth) : undefined;
      if (ftth) {
        await this.repo.updateWorkOrder(id, { ftth }, tenantId);
      }
      this.assertFtthCompletionAllowed(current, { ftth });
    }

    const updated = await this.repo.updateWorkOrderStatus(id, status, tenantId);
    if (!updated) throw new NotFoundError('Work order not found', 'NOT_FOUND');
    return updated;
  }

  /**
   * Gate de cierre FTTH: una orden de fibra no se completa sin serie de ONU,
   * puerto de CTO y potencia óptica dentro de rango. Las órdenes de radio pasan
   * sin condiciones.
   */
  private assertFtthCompletionAllowed(
    current: TaskOrder,
    patch: { technology?: unknown; ftth?: FtthWorkOrderFields },
  ): void {
    const technology = (patch.technology as TaskOrder['technology']) ?? current.technology;
    const ftth = { ...(current.ftth ?? {}), ...(patch.ftth ?? {}) };
    const result = validateFtthCompletion({ technology, ftth });
    if (result.ok) return;
    throw new FtthChecklistError(result);
  }

  async addWorkOrderEvidence(id: string, body: Record<string, unknown>, tenantId?: string) {
    const url = String(body.url || '').trim();
    if (!url) throw new BadRequestError('Missing required field: url', 'MISSING_FIELD');
    const updated = await this.repo.addWorkOrderEvidence(id, {
      kind: body.kind ? String(body.kind) : 'photo',
      url,
    }, tenantId);
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
