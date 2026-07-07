import { Tower } from '../../../src/types';
import { isDomainOnDb } from '../../config/feature-flags';
import { store } from '../../state/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';

export class NetworkService {
  private useDb = isDomainOnDb('network') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  constructor() {
    if (this.useDb) logger.info('Network: persistencia = Supabase (USE_DB_NETWORK=true)');
  }

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase not configured');
    return supabaseAdmin;
  }

  async listTowers(filters?: { status?: string; q?: string }) {
    if (this.useDb) {
      let q = this.admin.from('towers').select('*');
      if (filters?.status) q = q.eq('status', filters.status);
      const { data, error } = await q.order('name');
      if (error) throw error;
      let rows = (data ?? []).map(this.rowToTower);
      if (filters?.q) {
        const needle = filters.q.toLowerCase();
        rows = rows.filter((t) => t.name.toLowerCase().includes(needle));
      }
      return rows;
    }
    return store.TOWERS.filter((t) => {
      const matchStatus = !filters?.status || t.status === filters.status;
      const matchQ = !filters?.q || t.name.toLowerCase().includes(filters.q.toLowerCase());
      return matchStatus && matchQ;
    });
  }

  async getTower(id: string) {
    if (this.useDb) {
      const { data, error } = await this.admin.from('towers').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? this.rowToTower(data) : null;
    }
    return store.TOWERS.find((t) => t.id === id) ?? null;
  }

  private rowToTower(row: Record<string, unknown>): Tower {
    return {
      id: String(row.id),
      name: String(row.name),
      status: row.status as Tower['status'],
      lat: Number(row.lat),
      lng: Number(row.lng),
      height: Number(row.height ?? 30),
      coverageRadiusKm: Number(row.coverage_radius_km ?? 5),
      ip: String(row.ip ?? ''),
      cpu: 0,
      ram: 0,
      tempCelsius: 0,
      pingMs: 0,
      uptime: '—',
      ports: [],
      equipment: Array.isArray(row.equipment) ? (row.equipment as { name: string; type: string; brand: string }[]) : [],
      photos: Array.isArray(row.photos) ? row.photos as string[] : [],
    };
  }
}

let cached: NetworkService | null = null;
export const getNetworkService = () => {
  if (!cached) cached = new NetworkService();
  return cached;
};
