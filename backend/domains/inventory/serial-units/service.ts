import { isDomainOnDb } from '../../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../../services/supabase-admin';

export type SerialUnitStatus = 'available' | 'reserved' | 'installed' | 'rma' | 'retired';

export interface SerialUnit {
  id: string;
  itemId: string;
  serial: string;
  mac?: string;
  warrantyUntil?: string;
  status: SerialUnitStatus;
  clientId?: string;
  installedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

const memory: SerialUnit[] = [];
const uid = () => `ser-${Date.now()}`;
const stamp = () => new Date().toISOString();

export class SerialUnitsService {
  private useDb = isDomainOnDb('inventory') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  async list(filters?: { itemId?: string; status?: string; clientId?: string }) {
    if (this.useDb) {
      let q = this.admin.from('inventory_serial_units').select('*');
      if (filters?.itemId) q = q.eq('item_id', filters.itemId);
      if (filters?.status) q = q.eq('status', filters.status);
      if (filters?.clientId) q = q.eq('client_id', filters.clientId);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(this.rowToUnit);
    }
    return memory.filter((u) => {
      const matchItem = !filters?.itemId || u.itemId === filters.itemId;
      const matchStatus = !filters?.status || u.status === filters.status;
      const matchClient = !filters?.clientId || u.clientId === filters.clientId;
      return matchItem && matchStatus && matchClient;
    });
  }

  async create(body: Record<string, unknown>) {
    const itemId = String(body.itemId || '').trim();
    const serial = String(body.serial || '').trim();
    if (!itemId || !serial) {
      throw new BadRequestError('Missing required fields: itemId, serial', 'MISSING_FIELD');
    }
    const unit: SerialUnit = {
      id: uid(),
      itemId,
      serial,
      mac: body.mac ? String(body.mac) : undefined,
      warrantyUntil: body.warrantyUntil ? String(body.warrantyUntil) : undefined,
      status: (String(body.status || 'available') as SerialUnitStatus),
      clientId: body.clientId ? String(body.clientId) : undefined,
      installedAt: body.installedAt ? String(body.installedAt) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    if (this.useDb) {
      const { error } = await this.admin.from('inventory_serial_units').insert(this.unitToRow(unit));
      if (error) throw error;
    } else {
      memory.unshift(unit);
    }
    return unit;
  }

  async assignToClient(id: string, clientId: string) {
    const existing = memory.find((u) => u.id === id);
    if (!this.useDb && !existing) throw new NotFoundError('Serial unit not found', 'NOT_FOUND');
    const updated: Partial<SerialUnit> = {
      status: 'installed',
      clientId,
      installedAt: stamp(),
      updatedAt: stamp(),
    };
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('inventory_serial_units')
        .update({
          status: 'installed',
          client_id: clientId,
          installed_at: updated.installedAt,
          updated_at: updated.updatedAt,
        })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new NotFoundError('Serial unit not found', 'NOT_FOUND');
      return this.rowToUnit(data);
    }
    if (!existing) throw new NotFoundError('Serial unit not found', 'NOT_FOUND');
    Object.assign(existing, updated);
    return existing;
  }

  private rowToUnit(row: Record<string, unknown>): SerialUnit {
    return {
      id: String(row.id),
      itemId: String(row.item_id),
      serial: String(row.serial),
      mac: row.mac ? String(row.mac) : undefined,
      warrantyUntil: row.warranty_until ? String(row.warranty_until) : undefined,
      status: row.status as SerialUnitStatus,
      clientId: row.client_id ? String(row.client_id) : undefined,
      installedAt: row.installed_at ? String(row.installed_at) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private unitToRow(u: SerialUnit) {
    return {
      id: u.id,
      item_id: u.itemId,
      serial: u.serial,
      mac: u.mac ?? null,
      warranty_until: u.warrantyUntil ?? null,
      status: u.status,
      client_id: u.clientId ?? null,
      installed_at: u.installedAt ?? null,
      notes: u.notes ?? null,
      created_at: u.createdAt,
      updated_at: u.updatedAt,
    };
  }
}

let cached: SerialUnitsService | null = null;
export const getSerialUnitsService = () => {
  if (!cached) cached = new SerialUnitsService();
  return cached;
};
