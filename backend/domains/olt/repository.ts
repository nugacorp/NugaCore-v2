// ====================================================================
// Repositorio de OLTs gestionadas (store en memoria | Supabase).
// Flag: USE_DB_OLT (patrón directo, como USE_DB_WIREGUARD).
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { nowIso } from '../../common/time';
import type { OltDevice, OltProvisioningStatus } from './types';

const asBool = (v: string | undefined): boolean => (v || 'false').trim().toLowerCase() === 'true';
export const useDbOlt = (): boolean => asBool(process.env.USE_DB_OLT);

export interface OltRepository {
  list(tenantId: string): Promise<OltDevice[]>;
  get(tenantId: string, id: string): Promise<OltDevice | null>;
  create(device: OltDevice): Promise<OltDevice>;
  update(tenantId: string, id: string, patch: Partial<OltDevice>): Promise<OltDevice | null>;
  remove(tenantId: string, id: string): Promise<boolean>;
}

// ── Store en memoria ──────────────────────────────────────────────────
let MEM: OltDevice[] = [];
export const resetOltStore = (): void => { MEM = []; };

export class StoreOltRepository implements OltRepository {
  async list(tenantId: string): Promise<OltDevice[]> {
    return MEM.filter((o) => o.tenantId === tenantId);
  }
  async get(tenantId: string, id: string): Promise<OltDevice | null> {
    return MEM.find((o) => o.tenantId === tenantId && o.id === id) ?? null;
  }
  async create(device: OltDevice): Promise<OltDevice> {
    MEM.push(device);
    return device;
  }
  async update(tenantId: string, id: string, patch: Partial<OltDevice>): Promise<OltDevice | null> {
    const idx = MEM.findIndex((o) => o.tenantId === tenantId && o.id === id);
    if (idx < 0) return null;
    MEM[idx] = { ...MEM[idx], ...patch, updatedAt: nowIso() };
    return MEM[idx];
  }
  async remove(tenantId: string, id: string): Promise<boolean> {
    const before = MEM.length;
    MEM = MEM.filter((o) => !(o.tenantId === tenantId && o.id === id));
    return MEM.length < before;
  }
}

// ── Supabase (tabla public.olts) ──────────────────────────────────────
const enumStatus = (p: OltProvisioningStatus): 'online' | 'offline' =>
  p === 'online' ? 'online' : 'offline';

const rowToDevice = (row: Record<string, unknown>): OltDevice => ({
  id: String(row.id),
  tenantId: String(row.tenant_id ?? 'tenant-default'),
  name: String(row.name ?? ''),
  brand: String(row.brand ?? ''),
  model: String(row.model ?? ''),
  ponType: (String(row.pon_type ?? 'gpon') as OltDevice['ponType']),
  managementIp: String(row.ip ?? ''),
  managementVlan: row.management_vlan == null ? undefined : Number(row.management_vlan),
  sshPort: row.ssh_port == null ? 22 : Number(row.ssh_port),
  sshUsername: row.ssh_username == null ? undefined : String(row.ssh_username),
  towerId: row.tower_id == null ? undefined : String(row.tower_id),
  mikrotikRouterId: row.mikrotik_router_id == null ? undefined : String(row.mikrotik_router_id),
  uplinkPort: row.uplink_port == null ? undefined : String(row.uplink_port),
  provisioningStatus: (String(row.provisioning_status ?? 'planned') as OltProvisioningStatus),
  configProfile: (row.config_profile as Record<string, unknown>) ?? {},
  notes: row.notes == null ? undefined : String(row.notes),
  createdAt: String(row.created_at ?? nowIso()),
  updatedAt: String(row.updated_at ?? nowIso()),
});

const deviceToRow = (d: OltDevice): Record<string, unknown> => ({
  id: d.id,
  tenant_id: d.tenantId,
  name: d.name,
  brand: d.brand,
  model: d.model || null,
  ip: d.managementIp,
  pon_type: d.ponType,
  management_vlan: d.managementVlan ?? null,
  ssh_port: d.sshPort,
  ssh_username: d.sshUsername ?? null,
  tower_id: d.towerId ?? null,
  mikrotik_router_id: d.mikrotikRouterId ?? null,
  uplink_port: d.uplinkPort ?? null,
  status: enumStatus(d.provisioningStatus),
  provisioning_status: d.provisioningStatus,
  config_profile: d.configProfile ?? {},
  notes: d.notes ?? null,
  updated_at: d.updatedAt,
});

export class SupabaseOltRepository implements OltRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async list(tenantId: string): Promise<OltDevice[]> {
    const { data, error } = await this.admin
      .from('olts').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => rowToDevice(r as Record<string, unknown>));
  }
  async get(tenantId: string, id: string): Promise<OltDevice | null> {
    const { data, error } = await this.admin
      .from('olts').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? rowToDevice(data as Record<string, unknown>) : null;
  }
  async create(device: OltDevice): Promise<OltDevice> {
    const { data, error } = await this.admin
      .from('olts').insert(deviceToRow(device)).select('*').single();
    if (error) throw error;
    return rowToDevice(data as Record<string, unknown>);
  }
  async update(tenantId: string, id: string, patch: Partial<OltDevice>): Promise<OltDevice | null> {
    const current = await this.get(tenantId, id);
    if (!current) return null;
    const merged: OltDevice = { ...current, ...patch, updatedAt: nowIso() };
    const { data, error } = await this.admin
      .from('olts').update(deviceToRow(merged)).eq('tenant_id', tenantId).eq('id', id).select('*').single();
    if (error) throw error;
    return rowToDevice(data as Record<string, unknown>);
  }
  async remove(tenantId: string, id: string): Promise<boolean> {
    const { error, count } = await this.admin
      .from('olts').delete({ count: 'exact' }).eq('tenant_id', tenantId).eq('id', id);
    if (error) throw error;
    return (count ?? 0) > 0;
  }
}
