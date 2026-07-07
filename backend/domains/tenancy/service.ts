import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { logger } from '../../common/logger';

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}

const DEFAULT_TENANT: TenantView = {
  id: 'tenant-default',
  name: 'Default WISP',
  slug: 'default',
  status: 'active',
  createdAt: new Date().toISOString(),
};

export class TenancyService {
  private useDb = isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  constructor() {
    logger.info('Tenancy: modo single-WISP (OLA 6 foundation) — multi-tenant diseño');
  }

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase not configured');
    return supabaseAdmin;
  }

  status() {
    return {
      mode: 'single-wisp',
      multiTenantEnabled: false,
      defaultTenantId: DEFAULT_TENANT.id,
      note: 'SaaS multi-tenant (Fase 11) — schema listo, aislamiento RLS pendiente.',
    };
  }

  async listTenants(): Promise<TenantView[]> {
    if (this.useDb) {
      const { data, error } = await this.admin.from('tenants').select('*').order('name');
      if (error) throw error;
      if ((data ?? []).length === 0) return [DEFAULT_TENANT];
      return (data ?? []).map(this.rowToTenant);
    }
    return [DEFAULT_TENANT];
  }

  async getDefaultTenant(): Promise<TenantView> {
    const list = await this.listTenants();
    return list.find((t) => t.slug === 'default') ?? list[0] ?? DEFAULT_TENANT;
  }

  private rowToTenant(row: Record<string, unknown>): TenantView {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status ?? 'active'),
      createdAt: String(row.created_at ?? new Date().toISOString()),
    };
  }
}

let cached: TenancyService | null = null;
export const getTenancyService = () => {
  if (!cached) cached = new TenancyService();
  return cached;
};
