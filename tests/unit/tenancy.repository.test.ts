import { beforeEach, describe, expect, it } from 'vitest';
import { StoreTenancyRepository } from '../../backend/domains/tenancy/repository';
import { TenancyService, resetTenancyService } from '../../backend/domains/tenancy/service';
import { resolveTenantIdForUser } from '../../backend/domains/tenancy/resolve-tenant';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

describe('StoreTenancyRepository', () => {
  let repo: StoreTenancyRepository;

  beforeEach(() => {
    repo = new StoreTenancyRepository();
  });

  it('lista el tenant default', async () => {
    const list = await repo.listTenants();
    expect(list.some((t) => t.id === DEFAULT_TENANT_ID)).toBe(true);
  });

  it('crea tenant + membership owner', async () => {
    const tenant = await repo.createTenant({
      name: 'WISP Norte',
      slug: 'wisp-norte',
      ownerUserId: 'user-1',
    });
    expect(tenant.slug).toBe('wisp-norte');
    const memberships = await repo.listMembershipsByUser('user-1');
    expect(memberships).toHaveLength(1);
    expect(memberships[0].tenantId).toBe(tenant.id);
    expect(memberships[0].role).toBe('owner');
  });

  it('aísla memberships por usuario', async () => {
    const a = await repo.createTenant({ name: 'A', slug: 'a', ownerUserId: 'u-a' });
    await repo.createTenant({ name: 'B', slug: 'b', ownerUserId: 'u-b' });
    const forA = await repo.listMembershipsByUser('u-a');
    expect(forA.map((m) => m.tenantId)).toEqual([a.id]);
  });
});

describe('TenancyService status + resolve', () => {
  beforeEach(() => {
    delete process.env.MULTI_TENANT_ENABLED;
    resetTenancyService();
  });

  it('status single-wisp por defecto', () => {
    const status = new TenancyService(new StoreTenancyRepository()).status();
    expect(status.mode).toBe('single-wisp');
    expect(status.multiTenantEnabled).toBe(false);
  });

  it('status multi-tenant cuando flag activo', () => {
    process.env.MULTI_TENANT_ENABLED = 'true';
    const status = new TenancyService(new StoreTenancyRepository()).status();
    expect(status.mode).toBe('multi-tenant');
    expect(status.multiTenantEnabled).toBe(true);
  });

  it('resolveTenantIdForUser usa default si no hay memberships', async () => {
    resetTenancyService();
    const id = await resolveTenantIdForUser({
      userId: 'any-user-without-membership',
      requestedTenantId: null,
      source: 'supabase-jwt',
    });
    expect(id).toBe(DEFAULT_TENANT_ID);
  });

  it('resolveTenantIdForUser respeta membership (siempre, no solo con flag)', async () => {
    resetTenancyService();
    const { getTenancyService } = await import('../../backend/domains/tenancy/service');
    const svc = getTenancyService();
    const tenant = await svc.createTenant({
      name: 'Acme WISP',
      slug: 'acme',
      ownerUserId: 'owner-1',
    });

    const resolved = await resolveTenantIdForUser({
      userId: 'owner-1',
      requestedTenantId: tenant.id,
      source: 'supabase-jwt',
    });
    expect(resolved).toBe(tenant.id);

    const denied = await resolveTenantIdForUser({
      userId: 'owner-1',
      requestedTenantId: 'tenant-foreign',
      source: 'supabase-jwt',
    });
    // Sin membership en foreign → primera membership
    expect(denied).toBe(tenant.id);
  });
});
