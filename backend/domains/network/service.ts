import { Tower } from '../../../src/types';
import { isDomainOnDb } from '../../config/feature-flags';
import { store, type NetworkSector } from '../../state/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';

export interface TowerOnboardingProfile {
  towerId: string;
  zoneName?: string;
  billingCycleDay?: number;
  billingCycleTime?: string;
  routerId?: string;
  routerName?: string;
  updatedAt?: string;
}

const towerOnboardingMemory = new Map<string, TowerOnboardingProfile>();

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

  async listSectors(filters?: { towerId?: string }) {
    if (this.useDb) {
      let q = this.admin.from('network_sectors').select('*');
      if (filters?.towerId) q = q.eq('tower_id', filters.towerId);
      const { data, error } = await q.order('name');
      if (error) throw error;
      return (data ?? []).map(this.rowToSector);
    }
    return store.NETWORK_SECTORS.filter((s) => !filters?.towerId || s.towerId === filters.towerId);
  }

  async getTowerOnboarding(towerId: string): Promise<TowerOnboardingProfile | null> {
    if (this.useDb) {
      const { data, error } = await this.admin
        .from('tower_onboarding_profiles')
        .select('*')
        .eq('tower_id', towerId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        towerId: String(data.tower_id),
        zoneName: data.zone_name ? String(data.zone_name) : undefined,
        billingCycleDay: data.billing_cycle_day != null ? Number(data.billing_cycle_day) : undefined,
        billingCycleTime: data.billing_cycle_time ? String(data.billing_cycle_time) : undefined,
        routerId: data.router_id ? String(data.router_id) : undefined,
        routerName: data.router_name ? String(data.router_name) : undefined,
        updatedAt: data.updated_at ? String(data.updated_at) : undefined,
      };
    }
    return towerOnboardingMemory.get(towerId) ?? null;
  }

  async upsertTowerOnboarding(
    towerId: string,
    payload: Omit<TowerOnboardingProfile, 'towerId' | 'updatedAt'>,
  ): Promise<TowerOnboardingProfile> {
    if (this.useDb) {
      const record = {
        tower_id: towerId,
        zone_name: payload.zoneName ?? null,
        billing_cycle_day: payload.billingCycleDay ?? null,
        billing_cycle_time: payload.billingCycleTime ?? null,
        router_id: payload.routerId ?? null,
        router_name: payload.routerName ?? null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await this.admin
        .from('tower_onboarding_profiles')
        .upsert(record, { onConflict: 'tower_id' })
        .select('*')
        .single();
      if (error) throw error;
      return {
        towerId: String(data.tower_id),
        zoneName: data.zone_name ? String(data.zone_name) : undefined,
        billingCycleDay: data.billing_cycle_day != null ? Number(data.billing_cycle_day) : undefined,
        billingCycleTime: data.billing_cycle_time ? String(data.billing_cycle_time) : undefined,
        routerId: data.router_id ? String(data.router_id) : undefined,
        routerName: data.router_name ? String(data.router_name) : undefined,
        updatedAt: data.updated_at ? String(data.updated_at) : undefined,
      };
    }
    const profile: TowerOnboardingProfile = {
      towerId,
      zoneName: payload.zoneName,
      billingCycleDay: payload.billingCycleDay,
      billingCycleTime: payload.billingCycleTime,
      routerId: payload.routerId,
      routerName: payload.routerName,
      updatedAt: new Date().toISOString(),
    };
    towerOnboardingMemory.set(towerId, profile);
    return profile;
  }

  private rowToSector(row: Record<string, unknown>): NetworkSector {
    return {
      id: String(row.id),
      towerId: String(row.tower_id),
      name: String(row.name),
      azimuth: Number(row.azimuth ?? 0),
      frequency: String(row.frequency ?? ''),
      status: (row.status as NetworkSector['status']) ?? 'online',
      clientsCount: Number(row.clients_count ?? 0),
    };
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
