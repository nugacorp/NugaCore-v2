import { isDomainOnDb } from '../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';
import { commercialMemory, newAppointmentId, newProspectId, newQuoteId, stamp } from './memory-store';
import { getCustomersService } from '../customers/service';
import type { Client } from '../../../src/types';
import type {
  AppointmentStatus,
  AppointmentType,
  CommercialAppointment,
  CommercialProspect,
  CommercialQuote,
  CommercialStage,
  QuoteStatus,
} from './types';

const STAGES: CommercialStage[] = ['lead', 'visit', 'quote', 'contract', 'installation', 'won', 'lost'];

const matchesTenant = (recordTenantId: string | undefined, tenantId: string): boolean =>
  (recordTenantId || 'tenant-default') === tenantId;

export class CommercialService {
  private useDb = isDomainOnDb('commercial') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  constructor() {
    if (this.useDb) logger.info('Commercial CRM: persistencia = Supabase (USE_DB_COMMERCIAL=true)');
    else logger.info('Commercial CRM: persistencia = memoria (USE_DB_COMMERCIAL=false)');
  }

  // ── Prospects ──────────────────────────────────────────────────────
  async listProspects(filters: { stage?: string; q?: string; tenantId?: string }) {
    const tenantId = filters.tenantId;
    if (this.useDb) {
      let q = this.admin.from('commercial_prospects').select('*');
      if (tenantId) q = q.eq('tenant_id', tenantId);
      if (filters.stage) q = q.eq('stage', filters.stage);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      let rows = (data ?? []).map(this.rowToProspect);
      if (filters.q) {
        const needle = filters.q.toLowerCase();
        rows = rows.filter((p) => p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle));
      }
      return rows;
    }
    return commercialMemory.prospects.filter((p) => {
      const matchTenant = !tenantId || matchesTenant(p.tenantId, tenantId);
      const matchStage = !filters.stage || p.stage === filters.stage;
      const matchQ = !filters.q || p.name.toLowerCase().includes(filters.q.toLowerCase());
      return matchTenant && matchStage && matchQ;
    });
  }

  async getProspect(id: string, tenantId?: string) {
    if (this.useDb) {
      let q = this.admin.from('commercial_prospects').select('*').eq('id', id);
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data ? this.rowToProspect(data) : null;
    }
    const prospect = commercialMemory.prospects.find((p) => p.id === id) ?? null;
    if (!prospect || !tenantId) return prospect;
    return matchesTenant(prospect.tenantId, tenantId) ? prospect : null;
  }

  async createProspect(body: Record<string, unknown>, tenantId?: string) {
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestError('Missing required field: name', 'MISSING_FIELD');
    const stage = (String(body.stage || 'lead') as CommercialStage);
    if (!STAGES.includes(stage)) throw new BadRequestError('Invalid stage', 'INVALID_ENUM');
    const effectiveTenantId = tenantId || 'tenant-default';
    const prospect: CommercialProspect = {
      id: newProspectId(),
      tenantId: effectiveTenantId,
      name,
      phone: body.phone ? String(body.phone) : undefined,
      email: body.email ? String(body.email) : undefined,
      address: body.address ? String(body.address) : undefined,
      city: body.city ? String(body.city) : undefined,
      source: body.source ? String(body.source) : 'walk-in',
      stage,
      planId: body.planId ? String(body.planId) : undefined,
      assignedTo: body.assignedTo ? String(body.assignedTo) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      latitude: body.latitude !== undefined ? Number(body.latitude) : undefined,
      longitude: body.longitude !== undefined ? Number(body.longitude) : undefined,
      expectedCloseDate: body.expectedCloseDate ? String(body.expectedCloseDate) : undefined,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('commercial_prospects').insert(this.prospectToRow(prospect));
      if (error) throw error;
    } else {
      commercialMemory.prospects.unshift(prospect);
    }
    return prospect;
  }

  async advanceProspectStage(id: string, stage: CommercialStage, tenantId?: string) {
    if (!STAGES.includes(stage)) throw new BadRequestError('Invalid stage', 'INVALID_ENUM');
    const existing = await this.getProspect(id, tenantId);
    if (!existing) throw new NotFoundError('Prospect not found', 'NOT_FOUND');
    const updated = { ...existing, stage, updatedAt: stamp() };
    if (this.useDb) {
      let q = this.admin.from('commercial_prospects').update({ stage, updated_at: updated.updatedAt }).eq('id', id);
      if (tenantId) q = q.eq('tenant_id', tenantId);
      const { error } = await q;
      if (error) throw error;
    } else {
      const idx = commercialMemory.prospects.findIndex((p) => {
        if (p.id !== id) return false;
        if (tenantId && !matchesTenant(p.tenantId, tenantId)) return false;
        return true;
      });
      if (idx >= 0) commercialMemory.prospects[idx] = updated;
    }
    return updated;
  }

  async convertProspectToClient(prospectId: string, tenantId?: string) {
    const prospect = await this.getProspect(prospectId, tenantId);
    if (!prospect) throw new NotFoundError('Prospect not found', 'NOT_FOUND');
    const effectiveTenantId = tenantId || prospect.tenantId || 'tenant-default';
    const customers = getCustomersService();
    const id = await customers.generateClientId();
    const client: Client = {
      id,
      name: prospect.name,
      type: 'residential',
      status: 'lead',
      email: prospect.email ?? 'sin-correo@nuga.core',
      phone: prospect.phone ?? '',
      address: prospect.address ?? '',
      city: prospect.city ?? 'CDMX',
      lat: prospect.latitude ?? 19.4125,
      lng: prospect.longitude ?? -99.1555,
      planId: prospect.planId ?? 'plan-basic',
      tenantId: effectiveTenantId,
      connectionType: 'WISP',
      ip: '0.0.0.0',
    };
    await customers.create(client);
    await this.advanceProspectStage(prospectId, 'won', effectiveTenantId);
    return { client, prospectId };
  }

  // ── Quotes ─────────────────────────────────────────────────────────
  async listQuotes(filters: { prospectId?: string; status?: string; tenantId?: string }) {
    const tenantId = filters.tenantId;
    if (this.useDb) {
      let q = this.admin.from('commercial_quotes').select('*');
      if (tenantId) q = q.eq('tenant_id', tenantId);
      if (filters.prospectId) q = q.eq('prospect_id', filters.prospectId);
      if (filters.status) q = q.eq('status', filters.status);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(this.rowToQuote);
    }
    return commercialMemory.quotes.filter((q) => {
      const matchTenant = !tenantId || matchesTenant(q.tenantId, tenantId);
      const matchProspect = !filters.prospectId || q.prospectId === filters.prospectId;
      const matchStatus = !filters.status || q.status === filters.status;
      return matchTenant && matchProspect && matchStatus;
    });
  }

  async createQuote(body: Record<string, unknown>, tenantId?: string) {
    const title = String(body.title || '').trim();
    if (!title) throw new BadRequestError('Missing required field: title', 'MISSING_FIELD');
    const effectiveTenantId = tenantId || 'tenant-default';
    const quote: CommercialQuote = {
      id: newQuoteId(),
      tenantId: effectiveTenantId,
      prospectId: body.prospectId ? String(body.prospectId) : undefined,
      clientId: body.clientId ? String(body.clientId) : undefined,
      planId: body.planId ? String(body.planId) : undefined,
      title,
      amountCents: Math.round(Number(body.amountCents ?? body.amount ?? 0) * (body.amountCents !== undefined ? 1 : 100)),
      currency: body.currency ? String(body.currency) : 'MXN',
      status: (String(body.status || 'draft') as QuoteStatus),
      validUntil: body.validUntil ? String(body.validUntil) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('commercial_quotes').insert(this.quoteToRow(quote));
      if (error) throw error;
    } else {
      commercialMemory.quotes.unshift(quote);
    }
    return quote;
  }

  // ── Appointments ───────────────────────────────────────────────────
  async listAppointments(filters: { from?: string; to?: string; technicianId?: string; tenantId?: string }) {
    const tenantId = filters.tenantId;
    if (this.useDb) {
      let q = this.admin.from('commercial_appointments').select('*');
      if (tenantId) q = q.eq('tenant_id', tenantId);
      if (filters.from) q = q.gte('scheduled_at', filters.from);
      if (filters.to) q = q.lte('scheduled_at', filters.to);
      if (filters.technicianId) q = q.eq('technician_id', filters.technicianId);
      const { data, error } = await q.order('scheduled_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(this.rowToAppointment);
    }
    return commercialMemory.appointments.filter((a) => {
      const matchTenant = !tenantId || matchesTenant(a.tenantId, tenantId);
      const matchFrom = !filters.from || a.scheduledAt >= filters.from;
      const matchTo = !filters.to || a.scheduledAt <= filters.to;
      const matchTech = !filters.technicianId || a.technicianId === filters.technicianId;
      return matchTenant && matchFrom && matchTo && matchTech;
    });
  }

  async createAppointment(body: Record<string, unknown>, tenantId?: string) {
    const title = String(body.title || '').trim();
    const scheduledAt = String(body.scheduledAt || '').trim();
    if (!title || !scheduledAt) throw new BadRequestError('Missing required fields: title, scheduledAt', 'MISSING_FIELD');
    const effectiveTenantId = tenantId || 'tenant-default';
    const appt: CommercialAppointment = {
      id: newAppointmentId(),
      tenantId: effectiveTenantId,
      prospectId: body.prospectId ? String(body.prospectId) : undefined,
      clientId: body.clientId ? String(body.clientId) : undefined,
      workOrderId: body.workOrderId ? String(body.workOrderId) : undefined,
      title,
      appointmentType: (String(body.appointmentType || 'visit') as AppointmentType),
      scheduledAt,
      durationMinutes: Number(body.durationMinutes ?? 60),
      technicianId: body.technicianId ? String(body.technicianId) : undefined,
      technicianName: body.technicianName ? String(body.technicianName) : undefined,
      status: (String(body.status || 'scheduled') as AppointmentStatus),
      notes: body.notes ? String(body.notes) : undefined,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('commercial_appointments').insert(this.appointmentToRow(appt));
      if (error) throw error;
    } else {
      commercialMemory.appointments.unshift(appt);
    }
    return appt;
  }

  async getPipelineSummary(tenantId?: string) {
    const prospects = await this.listProspects({ tenantId });
    const stages = STAGES.map((stage) => ({
      stage,
      count: prospects.filter((p) => p.stage === stage).length,
    }));
    return { stages, totalProspects: prospects.length };
  }

  private rowToProspect(row: Record<string, unknown>): CommercialProspect {
    return {
      id: String(row.id),
      tenantId: row.tenant_id ? String(row.tenant_id) : 'tenant-default',
      name: String(row.name),
      phone: row.phone ? String(row.phone) : undefined,
      email: row.email ? String(row.email) : undefined,
      address: row.address ? String(row.address) : undefined,
      city: row.city ? String(row.city) : undefined,
      source: row.source ? String(row.source) : undefined,
      stage: row.stage as CommercialStage,
      planId: row.plan_id ? String(row.plan_id) : undefined,
      assignedTo: row.assigned_to ? String(row.assigned_to) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined,
      longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined,
      expectedCloseDate: row.expected_close_date ? String(row.expected_close_date) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private prospectToRow(p: CommercialProspect) {
    return {
      id: p.id,
      tenant_id: p.tenantId || 'tenant-default',
      name: p.name,
      phone: p.phone ?? null,
      email: p.email ?? null,
      address: p.address ?? null,
      city: p.city ?? null,
      source: p.source ?? null,
      stage: p.stage,
      plan_id: p.planId ?? null,
      assigned_to: p.assignedTo ?? null,
      notes: p.notes ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      expected_close_date: p.expectedCloseDate ?? null,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
  }

  private rowToQuote(row: Record<string, unknown>): CommercialQuote {
    return {
      id: String(row.id),
      tenantId: row.tenant_id ? String(row.tenant_id) : 'tenant-default',
      prospectId: row.prospect_id ? String(row.prospect_id) : undefined,
      clientId: row.client_id ? String(row.client_id) : undefined,
      planId: row.plan_id ? String(row.plan_id) : undefined,
      title: String(row.title),
      amountCents: Number(row.amount_cents),
      currency: String(row.currency),
      status: row.status as QuoteStatus,
      validUntil: row.valid_until ? String(row.valid_until) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private quoteToRow(q: CommercialQuote) {
    return {
      id: q.id,
      tenant_id: q.tenantId || 'tenant-default',
      prospect_id: q.prospectId ?? null,
      client_id: q.clientId ?? null,
      plan_id: q.planId ?? null,
      title: q.title,
      amount_cents: q.amountCents,
      currency: q.currency,
      status: q.status,
      valid_until: q.validUntil ?? null,
      notes: q.notes ?? null,
      created_at: q.createdAt,
      updated_at: q.updatedAt,
    };
  }

  private rowToAppointment(row: Record<string, unknown>): CommercialAppointment {
    return {
      id: String(row.id),
      tenantId: row.tenant_id ? String(row.tenant_id) : 'tenant-default',
      prospectId: row.prospect_id ? String(row.prospect_id) : undefined,
      clientId: row.client_id ? String(row.client_id) : undefined,
      workOrderId: row.work_order_id ? String(row.work_order_id) : undefined,
      title: String(row.title),
      appointmentType: row.appointment_type as AppointmentType,
      scheduledAt: String(row.scheduled_at),
      durationMinutes: Number(row.duration_minutes),
      technicianId: row.technician_id ? String(row.technician_id) : undefined,
      technicianName: row.technician_name ? String(row.technician_name) : undefined,
      status: row.status as AppointmentStatus,
      notes: row.notes ? String(row.notes) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private appointmentToRow(a: CommercialAppointment) {
    return {
      id: a.id,
      tenant_id: a.tenantId || 'tenant-default',
      prospect_id: a.prospectId ?? null,
      client_id: a.clientId ?? null,
      work_order_id: a.workOrderId ?? null,
      title: a.title,
      appointment_type: a.appointmentType,
      scheduled_at: a.scheduledAt,
      duration_minutes: a.durationMinutes,
      technician_id: a.technicianId ?? null,
      technician_name: a.technicianName ?? null,
      status: a.status,
      notes: a.notes ?? null,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    };
  }
}

let cached: CommercialService | null = null;
export const getCommercialService = () => {
  if (!cached) cached = new CommercialService();
  return cached;
};
