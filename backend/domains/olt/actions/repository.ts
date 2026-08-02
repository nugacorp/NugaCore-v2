// ====================================================================
// Repositorio de la cola de acciones OLT (store en memoria | Supabase).
// Flag: USE_DB_OLT, el mismo del CRUD de OLTs.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { nowIso } from '../../../common/time';
import type { OltActionType, OnuActionPayload } from '../command-builder';
import type { OltCliFlavor } from '../types';
import type { OltActionFilters, OltActionRecord, OltActionStatus } from './types';

const TABLE = 'olt_actions';

export interface OltActionsRepository {
  list(tenantId: string, filters?: OltActionFilters): Promise<OltActionRecord[]>;
  get(tenantId: string, id: string): Promise<OltActionRecord | null>;
  create(action: OltActionRecord): Promise<OltActionRecord>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<OltActionRecord, 'status' | 'result' | 'errorMessage' | 'attempts'>>,
  ): Promise<OltActionRecord | null>;
}

const matches = (action: OltActionRecord, filters?: OltActionFilters): boolean => {
  if (!filters) return true;
  if (filters.oltId && action.oltId !== filters.oltId) return false;
  if (filters.customerId && action.customerId !== filters.customerId) return false;
  if (filters.status && action.status !== filters.status) return false;
  return true;
};

// ── Store en memoria ──────────────────────────────────────────────────
let MEM: OltActionRecord[] = [];
export const resetOltActionsStore = (): void => {
  MEM = [];
};

export class StoreOltActionsRepository implements OltActionsRepository {
  async list(tenantId: string, filters?: OltActionFilters): Promise<OltActionRecord[]> {
    return MEM.filter((a) => a.tenantId === tenantId && matches(a, filters)).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async get(tenantId: string, id: string): Promise<OltActionRecord | null> {
    return MEM.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
  }

  async create(action: OltActionRecord): Promise<OltActionRecord> {
    MEM.unshift(action);
    return action;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<OltActionRecord, 'status' | 'result' | 'errorMessage' | 'attempts'>>,
  ): Promise<OltActionRecord | null> {
    const idx = MEM.findIndex((a) => a.tenantId === tenantId && a.id === id);
    if (idx < 0) return null;
    MEM[idx] = { ...MEM[idx], ...patch, updatedAt: nowIso() };
    return MEM[idx];
  }
}

// ── Supabase (tabla public.olt_actions) ───────────────────────────────
const rowToAction = (row: Record<string, unknown>): OltActionRecord => {
  const payload = (row.payload as OnuActionPayload | null) ?? {};
  const planned = Array.isArray(row.planned_commands) ? (row.planned_commands as string[]) : [];
  const result = (row.result as Record<string, unknown> | null) ?? undefined;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id ?? 'tenant-default'),
    oltId: String(row.olt_id ?? ''),
    customerId: row.customer_id == null ? undefined : String(row.customer_id),
    onuId: row.onu_id == null ? undefined : String(row.onu_id),
    actionType: String(row.action_type) as OltActionType,
    status: String(row.status ?? 'pending') as OltActionStatus,
    dryRun: row.dry_run !== false,
    cliFlavor: String(row.cli_flavor ?? 'generic') as OltCliFlavor,
    payload,
    plannedCommands: planned,
    // Las advertencias viajan dentro de result para no añadir una columna extra.
    warnings: Array.isArray(result?.warnings) ? (result!.warnings as string[]) : [],
    result,
    attempts: Number(row.attempts ?? 0),
    triggeredBy: row.triggered_by == null ? undefined : String(row.triggered_by),
    errorMessage: row.error_message == null ? undefined : String(row.error_message),
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
};

const actionToRow = (action: OltActionRecord): Record<string, unknown> => ({
  id: action.id,
  tenant_id: action.tenantId,
  olt_id: action.oltId,
  customer_id: action.customerId ?? null,
  onu_id: action.onuId ?? null,
  action_type: action.actionType,
  status: action.status,
  dry_run: action.dryRun,
  cli_flavor: action.cliFlavor,
  payload: action.payload,
  planned_commands: action.plannedCommands,
  result: { ...(action.result ?? {}), warnings: action.warnings },
  attempts: action.attempts,
  triggered_by: action.triggeredBy ?? null,
  error_message: action.errorMessage ?? null,
  created_at: action.createdAt,
  updated_at: action.updatedAt,
});

export class SupabaseOltActionsRepository implements OltActionsRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async list(tenantId: string, filters?: OltActionFilters): Promise<OltActionRecord[]> {
    let query = this.admin
      .from(TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });
    if (filters?.oltId) query = query.eq('olt_id', filters.oltId);
    if (filters?.customerId) query = query.eq('customer_id', filters.customerId);
    if (filters?.status) query = query.eq('status', filters.status);
    const { data, error } = await query;
    if (error) throw new Error(`listOltActions: ${error.message}`);
    return (data ?? []).map((row) => rowToAction(row as Record<string, unknown>));
  }

  async get(tenantId: string, id: string): Promise<OltActionRecord | null> {
    const { data, error } = await this.admin
      .from(TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getOltAction: ${error.message}`);
    return data ? rowToAction(data as Record<string, unknown>) : null;
  }

  async create(action: OltActionRecord): Promise<OltActionRecord> {
    const { error } = await this.admin.from(TABLE).insert(actionToRow(action));
    if (error) throw new Error(`createOltAction: ${error.message}`);
    return action;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<OltActionRecord, 'status' | 'result' | 'errorMessage' | 'attempts'>>,
  ): Promise<OltActionRecord | null> {
    const row: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.result !== undefined) row.result = patch.result;
    if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    const { error } = await this.admin
      .from(TABLE)
      .update(row)
      .eq('tenant_id', tenantId)
      .eq('id', id);
    if (error) throw new Error(`updateOltAction: ${error.message}`);
    return this.get(tenantId, id);
  }
}
