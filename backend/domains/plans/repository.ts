// ====================================================================
// Repository del dominio Plans.
//
// Define el contrato `PlansRepository` y dos implementaciones con la
// MISMA interfaz:
//   - StorePlansRepository    → store en memoria (modo mock, default).
//   - SupabasePlansRepository → Supabase/PostgreSQL (modo DB).
//
// El service elige una u otra según el feature flag USE_DB_PLANS.
// El contrato de API v1 no cambia: ambos devuelven `PlanRecord`
// (= Plan + { businessType, isActive }).
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { Plan } from '../../../src/types';
import { store } from '../../state/store';
import { logger } from '../../common/logger';
import {
  PlanRecord,
  PlanRow,
  planPatchToRow,
  planToRow,
  rowToPlan,
} from './mappers';

export interface PlanFilters {
  q?: string;            // ya normalizado a minúsculas por la ruta
  status?: string;       // '' | 'active' | 'inactive' (cualquier valor != 'active' filtra inactivos)
  businessType?: string; // ya normalizado a minúsculas por la ruta
  tenantId?: string;
}

export interface PlansRepository {
  list(filters: PlanFilters): Promise<PlanRecord[]>;
  findById(id: string, tenantId?: string): Promise<PlanRecord | null>;
  /** Busca por nombre (case-insensitive) para detectar duplicados en el alta. */
  findByName(name: string, tenantId?: string): Promise<PlanRecord | null>;
  create(plan: PlanRecord): Promise<PlanRecord>;
  update(id: string, patch: Partial<PlanRecord>, tenantId?: string): Promise<PlanRecord | null>;
  remove(id: string, tenantId?: string): Promise<boolean>;
  /** ¿Algún cliente referencia este plan? (bloquea el borrado con 409). */
  isInUse(id: string, tenantId?: string): Promise<boolean>;
  /** Genera el siguiente id con formato slug `plan-N`. */
  generateId(): Promise<string>;
}

// --------------------------------------------------------------------
// Implementación MOCK (store en memoria). Replica EXACTAMENTE la lógica
// que vivía en routes.ts: combina store.PLANS + store.PLAN_METADATA.
// --------------------------------------------------------------------
export class StorePlansRepository implements PlansRepository {
  private toRecord(plan: Plan): PlanRecord {
    const meta = store.getPlanMetadata(plan.id);
    return { ...plan, businessType: meta.businessType, isActive: meta.isActive };
  }

  async list(filters: PlanFilters): Promise<PlanRecord[]> {
    const { q, status, businessType, tenantId } = filters;
    return store.PLANS.map((plan) => this.toRecord(plan)).filter((plan) => {
      const matchesTenant = !tenantId || (plan.tenantId || 'tenant-default') === tenantId;
      const matchesQ =
        !q || plan.name.toLowerCase().includes(q) || plan.id.toLowerCase().includes(q);
      const matchesStatus = !status || (status === 'active' ? plan.isActive : !plan.isActive);
      const matchesBusinessType =
        !businessType || plan.businessType.toLowerCase() === businessType;
      return matchesTenant && matchesQ && matchesStatus && matchesBusinessType;
    });
  }

  async findById(id: string, tenantId?: string): Promise<PlanRecord | null> {
    const plan = store.PLANS.find((p) => p.id === id);
    if (!plan) return null;
    const record = this.toRecord(plan);
    if (tenantId && (record.tenantId || 'tenant-default') !== tenantId) return null;
    return record;
  }

  async findByName(name: string, tenantId?: string): Promise<PlanRecord | null> {
    const lower = name.trim().toLowerCase();
    const plan = store.PLANS.find((p) => {
      if (p.name.toLowerCase() !== lower) return false;
      if (tenantId && (p.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    return plan ? this.toRecord(plan) : null;
  }

  async create(record: PlanRecord): Promise<PlanRecord> {
    const { businessType, isActive, ...plan } = record;
    store.PLANS.push({ ...plan, tenantId: record.tenantId || 'tenant-default' });
    store.PLAN_METADATA.push({ planId: record.id, businessType, isActive });
    return { ...record, tenantId: record.tenantId || 'tenant-default' };
  }

  async update(id: string, patch: Partial<PlanRecord>, tenantId?: string): Promise<PlanRecord | null> {
    const index = store.PLANS.findIndex((p) => {
      if (p.id !== id) return false;
      if (tenantId && (p.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
    if (index === -1) return null;

    const target = store.PLANS[index];
    store.PLANS[index] = {
      ...target,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.speedMbpsDown !== undefined ? { speedMbpsDown: patch.speedMbpsDown } : {}),
      ...(patch.speedMbpsUp !== undefined ? { speedMbpsUp: patch.speedMbpsUp } : {}),
      ...(patch.price !== undefined ? { price: patch.price } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
    };

    const meta = store.getPlanMetadata(id);
    if (patch.businessType !== undefined) meta.businessType = patch.businessType;
    if (patch.isActive !== undefined) meta.isActive = patch.isActive;

    return this.toRecord(store.PLANS[index]);
  }

  async remove(id: string, tenantId?: string): Promise<boolean> {
    const before = store.PLANS.length;
    store.PLANS = store.PLANS.filter((p) => {
      if (p.id !== id) return true;
      if (tenantId && (p.tenantId || 'tenant-default') !== tenantId) return true;
      return false;
    });
    if (store.PLANS.length === before) return false;
    store.PLAN_METADATA = store.PLAN_METADATA.filter((m) => m.planId !== id);
    return true;
  }

  async isInUse(id: string, tenantId?: string): Promise<boolean> {
    return store.CLIENTS.some((client) => {
      if (client.planId !== id) return false;
      if (tenantId && (client.tenantId || 'tenant-default') !== tenantId) return false;
      return true;
    });
  }

  async generateId(): Promise<string> {
    return store.getUniquePlanId();
  }
}

// --------------------------------------------------------------------
// Implementación DB (Supabase / PostgreSQL). Usa el cliente admin
// (service-role) — SIEMPRE del lado servidor, nunca expuesto al frontend.
// --------------------------------------------------------------------
const PLANS_TABLE = 'plans';
const CLIENTS_TABLE = 'clients';

const fail = (context: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Supabase plans repository error: ${context}`, { message });
  throw new Error(`Plans DB error (${context}): ${message}`);
};

export class SupabasePlansRepository implements PlansRepository {
  constructor(private readonly client: SupabaseClient) {}

  async list(filters: PlanFilters): Promise<PlanRecord[]> {
    let query = this.client.from(PLANS_TABLE).select('*');
    if (filters.tenantId) query = query.eq('tenant_id', filters.tenantId);
    if (filters.q) query = query.or(`name.ilike.%${filters.q}%,id.ilike.%${filters.q}%`);
    if (filters.status) query = query.eq('is_active', filters.status === 'active');
    // businessType llega en minúsculas; ilike compara case-insensitive contra 'Residencial', …
    if (filters.businessType) query = query.ilike('business_type', filters.businessType);

    const { data, error } = await query;
    if (error) return fail('list', error);
    return (data as PlanRow[]).map(rowToPlan);
  }

  async findById(id: string, tenantId?: string): Promise<PlanRecord | null> {
    let query = this.client.from(PLANS_TABLE).select('*').eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.maybeSingle();
    if (error) return fail('findById', error);
    return data ? rowToPlan(data as PlanRow) : null;
  }

  async findByName(name: string, tenantId?: string): Promise<PlanRecord | null> {
    let query = this.client.from(PLANS_TABLE).select('*').ilike('name', name.trim());
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.maybeSingle();
    if (error) return fail('findByName', error);
    return data ? rowToPlan(data as PlanRow) : null;
  }

  async create(record: PlanRecord): Promise<PlanRecord> {
    const row = planToRow(record);
    let { data, error } = await this.client.from(PLANS_TABLE).insert(row).select('*').single();
    if (error && /tenant_id/i.test(error.message || '')) {
      const { tenant_id: _omit, ...without } = row;
      ({ data, error } = await this.client.from(PLANS_TABLE).insert(without).select('*').single());
    }
    if (error) return fail('create', error);
    return rowToPlan(data as PlanRow);
  }

  async update(id: string, patch: Partial<PlanRecord>, tenantId?: string): Promise<PlanRecord | null> {
    const row = planPatchToRow(patch);
    if (Object.keys(row).length === 0) {
      return this.findById(id, tenantId);
    }
    let query = this.client.from(PLANS_TABLE).update(row).eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) return fail('update', error);
    return data ? rowToPlan(data as PlanRow) : null;
  }

  async remove(id: string, tenantId?: string): Promise<boolean> {
    let query = this.client.from(PLANS_TABLE).delete({ count: 'exact' }).eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { error, count } = await query;
    if (error) return fail('remove', error);
    return (count ?? 0) > 0;
  }

  async isInUse(id: string, tenantId?: string): Promise<boolean> {
    let query = this.client
      .from(CLIENTS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { count, error } = await query;
    if (error) return fail('isInUse', error);
    return (count ?? 0) > 0;
  }

  async generateId(): Promise<string> {
    const { data, error } = await this.client.from(PLANS_TABLE).select('id').like('id', 'plan-%');
    if (error) return fail('generateId', error);
    const max = (data as { id: string }[]).reduce((acc, row) => {
      const n = parseInt(String(row.id).slice('plan-'.length), 10);
      return Number.isFinite(n) && n > acc ? n : acc;
    }, 0);
    return `plan-${max + 1}`;
  }
}
