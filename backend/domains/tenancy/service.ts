// ====================================================================
// Service Tenancy — orquesta repository Store/Supabase.
// ====================================================================

import { BadRequestError } from '../../common/errors';
import { logger } from '../../common/logger';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { isLegacySingleWispFallbackEnabled, isMultiTenantEnabled } from './flags';
import {
  StoreTenancyRepository,
  SupabaseTenancyRepository,
  type TenancyRepository,
} from './repository';
import {
  DEFAULT_TENANT_ID,
  type CreateMembershipInput,
  type CreateTenantInput,
  type Tenant,
  type TenantMembership,
  type TenancyStatusView,
} from './types';

const useDbTenancy = (): boolean => {
  const explicit = (process.env.USE_DB_TENANCY || '').trim().toLowerCase();
  if (explicit === 'true') return isSupabaseAdminConfigured && Boolean(supabaseAdmin);
  if (explicit === 'false') return false;
  // Auto: con Supabase admin → DB. Necesario para registro WISP (wisp_onboarding
  // tiene FK a tenants). MULTI_TENANT_ENABLED ya no condiciona la persistencia.
  return isSupabaseAdminConfigured && Boolean(supabaseAdmin);
};

export class TenancyService {
  constructor(private readonly repo: TenancyRepository) {}

  status(): TenancyStatusView {
    const enabled = isMultiTenantEnabled();
    return {
      mode: enabled ? 'multi-tenant' : 'single-wisp',
      multiTenantEnabled: enabled,
      defaultTenantId: DEFAULT_TENANT_ID,
      note: enabled
        ? 'Multi-tenant activo: aislamiento por tenant_id + memberships + RLS authenticated.'
        : 'Single-WISP (default). Activa MULTI_TENANT_ENABLED=true para aislamiento multi-tenant.',
    };
  }

  listTenants(): Promise<Tenant[]> {
    return this.repo.listTenants();
  }

  async getDefaultTenant(): Promise<Tenant> {
    const list = await this.repo.listTenants();
    return list.find((t) => t.slug === 'default')
      ?? list.find((t) => t.id === DEFAULT_TENANT_ID)
      ?? list[0]
      ?? {
        id: DEFAULT_TENANT_ID,
        name: 'Default WISP',
        slug: 'default',
        status: 'active' as const,
        createdAt: new Date(0).toISOString(),
      };
  }

  getTenant(id: string): Promise<Tenant | null> {
    return this.repo.findTenantById(id);
  }

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const name = String(input.name || '').trim();
    const slug = String(input.slug || '').trim().toLowerCase();
    if (!name || !slug) {
      throw new BadRequestError('Missing required fields: name, slug', 'MISSING_FIELD');
    }
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      throw new BadRequestError(
        'Invalid slug: use lowercase alphanumeric and hyphens',
        'INVALID_SLUG',
      );
    }
    return this.repo.createTenant({
      ...input,
      name,
      slug,
    });
  }

  /** Solo memberships ACTIVAS: es la base de la resolución de tenant. */
  listMembershipsForUser(userId: string): Promise<TenantMembership[]> {
    return this.repo.listMembershipsByUser(userId);
  }

  /** Incluye inactivas. Solo para diagnóstico de denegaciones (MT-02). */
  listAllMembershipsForUser(userId: string): Promise<TenantMembership[]> {
    return this.repo.listAllMembershipsByUser(userId);
  }

  getMembership(tenantId: string, userId: string): Promise<TenantMembership | null> {
    return this.repo.findMembership(tenantId, userId);
  }

  listMembershipsForTenant(tenantId: string): Promise<TenantMembership[]> {
    return this.repo.listMembershipsByTenant(tenantId);
  }

  async ensureMembership(input: CreateMembershipInput): Promise<TenantMembership> {
    if (!input.tenantId || !input.userId) {
      throw new BadRequestError('Missing required fields: tenantId, userId', 'MISSING_FIELD');
    }
    const tenant = await this.repo.findTenantById(input.tenantId);
    if (!tenant) {
      throw new BadRequestError('Tenant not found', 'TENANT_NOT_FOUND');
    }
    return this.repo.createMembership(input);
  }

  removeMembership(id: string): Promise<boolean> {
    return this.repo.removeMembership(id);
  }

  /**
   * ¿El usuario puede operar en este tenant? Fail-closed (MT-02): exige
   * membresía ACTIVA. `tenant-default` sin memberships solo se concede bajo
   * el gate legacy single-WISP, que está apagado en runtime endurecido.
   */
  async userCanAccessTenant(userId: string, tenantId: string): Promise<boolean> {
    if (!tenantId || !userId) return false;
    const m = await this.repo.findMembership(tenantId, userId);
    if (m && m.status === 'active') return true;
    if (tenantId === DEFAULT_TENANT_ID && isLegacySingleWispFallbackEnabled()) {
      const memberships = await this.repo.listAllMembershipsByUser(userId);
      return memberships.length === 0;
    }
    return false;
  }
}

let singleton: TenancyService | null = null;
let storeRepoSingleton: StoreTenancyRepository | null = null;

const buildService = (): TenancyService => {
  if (useDbTenancy()) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'Tenancy DB requerida pero Supabase no está configurado. '
          + 'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, o USE_DB_TENANCY=false.',
      );
    }
    logger.info('Tenancy: persistencia = Supabase');
    return new TenancyService(new SupabaseTenancyRepository(supabaseAdmin));
  }
  logger.info(
    isMultiTenantEnabled()
      ? 'Tenancy: multi-tenant (store en memoria)'
      : 'Tenancy: single-WISP (store en memoria)',
  );
  if (!storeRepoSingleton) storeRepoSingleton = new StoreTenancyRepository();
  return new TenancyService(storeRepoSingleton);
};

export const getTenancyService = (): TenancyService => {
  if (!singleton) singleton = buildService();
  return singleton;
};

/** Tests: reconstruir singleton / store. */
export const resetTenancyService = (): void => {
  singleton = null;
  if (storeRepoSingleton) storeRepoSingleton.reset();
  storeRepoSingleton = null;
};

export { DEFAULT_TENANT_ID };
