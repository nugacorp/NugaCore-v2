// ====================================================================
// Repositorio Router Enrollment (Fase 4.7 + DB persistence Fase 4.9.2.1).
//
//  - `enrollmentRepository`: store SÍNCRONO en memoria (sin cambios).
//    Lo siguen usando los tests directamente (._reset / .list / .nextId).
//  - `RouterEnrollmentRepository`: interfaz ASÍNCRONA usada por el service.
//  - `StoreRouterEnrollmentRepository`: adaptador async sobre el store.
//  - `SupabaseRouterEnrollmentRepository`: persistencia real en Supabase.
//  - `getEnrollmentRepository()`: factoría por feature flag
//    USE_DB_ROUTER_ENROLLMENT (default false → store).
//
// Tabla canónica: public.router_enrollment. El script .rsc NUNCA se
// persiste (solo script_hash). template_parameters viaja como JSONB.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../../common/logger';
import { useDbRouterEnrollment } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { RouterEnrollmentRecord } from './types';
import { RouterEnrollmentRow, rowToEnrollment, enrollmentToRow, enrollmentPatchToRow } from './mappers';

const TABLE = 'router_enrollment';

// ════════════════════════════════════════════════════════════════════
// Store en memoria (síncrono) — base para tests y para el adaptador async
// ════════════════════════════════════════════════════════════════════

const RECORDS: RouterEnrollmentRecord[] = [];
let _counter = 0;

import { nowIso } from '../../common/time';

function nextId(): string {
  _counter++;
  let n = _counter;
  const ids = new Set(RECORDS.map((r) => r.id));
  while (ids.has(`enr-${n}`)) n++;
  return `enr-${n}`;
}

export const enrollmentRepository = {
  create(rec: RouterEnrollmentRecord): RouterEnrollmentRecord {
    RECORDS.unshift(rec);
    return rec;
  },

  getById(id: string): RouterEnrollmentRecord | undefined {
    return RECORDS.find((r) => r.id === id);
  },

  list(): RouterEnrollmentRecord[] {
    return [...RECORDS];
  },

  update(id: string, patch: Partial<RouterEnrollmentRecord>): RouterEnrollmentRecord | undefined {
    const idx = RECORDS.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    RECORDS[idx] = { ...RECORDS[idx], ...patch, updatedAt: nowIso() };
    return RECORDS[idx];
  },

  delete(id: string): boolean {
    const idx = RECORDS.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    RECORDS.splice(idx, 1);
    return true;
  },

  nextId,

  /** Solo para tests: limpia el repositorio. */
  _reset(): void {
    RECORDS.length = 0;
    _counter = 0;
  },
};

// ════════════════════════════════════════════════════════════════════
// Interfaz async (usada por el service)
// ════════════════════════════════════════════════════════════════════

export interface RouterEnrollmentRepository {
  create(record: RouterEnrollmentRecord): Promise<RouterEnrollmentRecord>;
  findById(id: string): Promise<RouterEnrollmentRecord | null>;
  list(tenantId?: string): Promise<RouterEnrollmentRecord[]>;
  update(id: string, patch: Partial<RouterEnrollmentRecord>): Promise<RouterEnrollmentRecord | null>;
  delete(id: string): Promise<boolean>;
  findByRouterId(routerId: string): Promise<RouterEnrollmentRecord[]>;
  findByPeerId(peerId: string): Promise<RouterEnrollmentRecord[]>;
  nextId(): Promise<string>;
}

// ════════════════════════════════════════════════════════════════════
// Store (async adapter sobre enrollmentRepository)
// ════════════════════════════════════════════════════════════════════

export class StoreRouterEnrollmentRepository implements RouterEnrollmentRepository {
  async create(record: RouterEnrollmentRecord) {
    return enrollmentRepository.create(record);
  }
  async findById(id: string) {
    return enrollmentRepository.getById(id) ?? null;
  }
  async list(tenantId?: string) {
    const rows = enrollmentRepository.list();
    if (!tenantId) return rows;
    return rows.filter((r) => (r.tenantId || 'tenant-default') === tenantId);
  }
  async update(id: string, patch: Partial<RouterEnrollmentRecord>) {
    return enrollmentRepository.update(id, patch) ?? null;
  }
  async delete(id: string) {
    return enrollmentRepository.delete(id);
  }
  async findByRouterId(routerId: string) {
    return enrollmentRepository.list().filter((r) => r.routerId === routerId);
  }
  async findByPeerId(peerId: string) {
    return enrollmentRepository.list().filter((r) => r.wgPeerId === peerId);
  }
  async nextId() {
    return enrollmentRepository.nextId();
  }
}

// ════════════════════════════════════════════════════════════════════
// Supabase
// ════════════════════════════════════════════════════════════════════

export class SupabaseRouterEnrollmentRepository implements RouterEnrollmentRepository {
  constructor(private readonly client: SupabaseClient) {}
  private seq = Date.now();

  async nextId(): Promise<string> {
    // ID único TEXT (PK). No depende de un contador en memoria.
    return `enr-${(this.seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async create(record: RouterEnrollmentRecord): Promise<RouterEnrollmentRecord> {
    const row = enrollmentToRow(record);
    let { error } = await this.client.from(TABLE).insert(row);
    // Compat: staging puede no tener aún la migración tenant_id.
    if (error && /tenant_id/i.test(error.message || '')) {
      const { tenant_id: _omit, ...withoutTenant } = row;
      ({ error } = await this.client.from(TABLE).insert(withoutTenant));
    }
    if (error) throw new Error(`router_enrollment.create: ${error.message}`);
    return record;
  }

  async findById(id: string): Promise<RouterEnrollmentRecord | null> {
    const { data, error } = await this.client.from(TABLE).select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`router_enrollment.findById: ${error.message}`);
    return data ? rowToEnrollment(data as RouterEnrollmentRow) : null;
  }

  async list(tenantId?: string): Promise<RouterEnrollmentRecord[]> {
    let q = this.client.from(TABLE).select('*').order('created_at', { ascending: false });
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data, error } = await q;
    if (error) throw new Error(`router_enrollment.list: ${error.message}`);
    return (data || []).map((r) => rowToEnrollment(r as RouterEnrollmentRow));
  }

  async update(id: string, patch: Partial<RouterEnrollmentRecord>): Promise<RouterEnrollmentRecord | null> {
    const row = enrollmentPatchToRow(patch);
    if (Object.keys(row).length > 0) {
      const { error } = await this.client.from(TABLE).update(row).eq('id', id);
      if (error) throw new Error(`router_enrollment.update: ${error.message}`);
    }
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.findById(id);
    if (!existing) return false;
    const { error } = await this.client.from(TABLE).delete().eq('id', id);
    if (error) throw new Error(`router_enrollment.delete: ${error.message}`);
    return true;
  }

  async findByRouterId(routerId: string): Promise<RouterEnrollmentRecord[]> {
    const { data, error } = await this.client.from(TABLE).select('*').eq('router_id', routerId);
    if (error) throw new Error(`router_enrollment.findByRouterId: ${error.message}`);
    return (data || []).map((r) => rowToEnrollment(r as RouterEnrollmentRow));
  }

  async findByPeerId(peerId: string): Promise<RouterEnrollmentRecord[]> {
    const { data, error } = await this.client.from(TABLE).select('*').eq('wg_peer_id', peerId);
    if (error) throw new Error(`router_enrollment.findByPeerId: ${error.message}`);
    return (data || []).map((r) => rowToEnrollment(r as RouterEnrollmentRow));
  }
}

// ════════════════════════════════════════════════════════════════════
// Factoría por feature flag
// ════════════════════════════════════════════════════════════════════

let repoSingleton: RouterEnrollmentRepository | null = null;

const build = (): RouterEnrollmentRepository => {
  if (useDbRouterEnrollment()) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error('USE_DB_ROUTER_ENROLLMENT=true pero Supabase no está configurado.');
    }
    logger.info('Router Enrollment: persistencia = Supabase (USE_DB_ROUTER_ENROLLMENT=true)');
    return new SupabaseRouterEnrollmentRepository(supabaseAdmin);
  }
  logger.info('Router Enrollment: persistencia = store en memoria (USE_DB_ROUTER_ENROLLMENT=false)');
  return new StoreRouterEnrollmentRepository();
};

export const getEnrollmentRepository = (): RouterEnrollmentRepository => {
  if (!repoSingleton) repoSingleton = build();
  return repoSingleton;
};

/** Sólo tests: reconstruye el repositorio (p.ej. tras cambiar el flag). */
export const resetEnrollmentRepository = (): void => { repoSingleton = null; };
