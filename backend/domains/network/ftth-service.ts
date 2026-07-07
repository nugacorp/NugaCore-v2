import { NapBox, OnuFTTH, OltFTTH } from '../../../src/types';
import { isDomainOnDb } from '../../config/feature-flags';
import { store } from '../../state/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';

export class FtthService {
  private useDb = isDomainOnDb('ftth') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  constructor() {
    if (this.useDb) logger.info('FTTH: persistencia = Supabase (USE_DB_FTTH=true)');
  }

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase not configured');
    return supabaseAdmin;
  }

  async listOlts(): Promise<OltFTTH[]> {
    if (this.useDb) {
      const { data, error } = await this.admin.from('olts').select('*').order('name');
      if (error) throw error;
      return (data ?? []).map(this.rowToOlt);
    }
    return store.OLTS;
  }

  async listOnus(): Promise<OnuFTTH[]> {
    if (this.useDb) {
      const { data, error } = await this.admin.from('onus').select('*');
      if (error) throw error;
      return (data ?? []).map(this.rowToOnu);
    }
    return store.ONUS;
  }

  async listNaps(): Promise<NapBox[]> {
    if (this.useDb) {
      const { data, error } = await this.admin.from('nap_boxes').select('*');
      if (error) throw error;
      return (data ?? []).map(this.rowToNap);
    }
    return store.NAP_BOXES;
  }

  private rowToOlt(row: Record<string, unknown>): OltFTTH {
    return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as OltFTTH['status'],
      brand: String(row.brand ?? 'GPON') as OltFTTH['brand'],
      ip: String(row.ip),
      portsCount: Number(row.ports_count ?? 16),
      onusConnected: Number(row.onus_connected ?? 0),
      onusLimit: Number(row.onus_limit ?? 1024),
      splitters: Array.isArray(row.splitters) ? row.splitters as OltFTTH['splitters'] : [],
    };
  }

  private rowToOnu(row: Record<string, unknown>): OnuFTTH {
    return {
      id: String(row.id),
      clientId: String(row.client_id ?? ''),
      clientName: String(row.client_name ?? ''),
      oltId: String(row.olt_id ?? 'olt-1'),
      port: Number(row.port ?? 1),
      mac: String(row.mac ?? ''),
      signalDb: Number(row.signal_db ?? -25),
      status: row.status as OnuFTTH['status'],
      brand: String(row.brand ?? ''),
      model: String(row.model ?? ''),
      napId: row.nap_id ? String(row.nap_id) : undefined,
      napPort: row.nap_port != null ? Number(row.nap_port) : undefined,
    };
  }

  private rowToNap(row: Record<string, unknown>): NapBox {
    return {
      id: String(row.id),
      name: String(row.name),
      ponPort: String(row.pon_port ?? '1/1'),
      lat: Number(row.lat ?? 0),
      lng: Number(row.lng ?? 0),
      fibersTotal: Number(row.fibers_total ?? 8),
      fibersFree: Number(row.fibers_free ?? 8),
      splitRatio: String(row.split_ratio ?? '1:8'),
      coverageMeters: Number(row.coverage_meters ?? 200),
      ports: Array.isArray(row.ports) ? row.ports as NapBox['ports'] : [],
    };
  }
}

let cached: FtthService | null = null;
export const getFtthService = () => {
  if (!cached) cached = new FtthService();
  return cached;
};
