import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { StoreTenancyRepository } from '../../backend/domains/tenancy/repository';
import { TenancyService, resetTenancyService } from '../../backend/domains/tenancy/service';
import { resolveTenantIdForUser } from '../../backend/domains/tenancy/resolve-tenant';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

const savedLegacyFallback = process.env.LEGACY_SINGLE_WISP_FALLBACK;

afterAll(() => {
  if (savedLegacyFallback === undefined) delete process.env.LEGACY_SINGLE_WISP_FALLBACK;
  else process.env.LEGACY_SINGLE_WISP_FALLBACK = savedLegacyFallback;
});

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
    delete process.env.LEGACY_SINGLE_WISP_FALLBACK;
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

  it('resolveTenantIdForUser deniega si no hay memberships', async () => {
    resetTenancyService();
    await expect(
      resolveTenantIdForUser({
        userId: 'any-user-without-membership',
        requestedTenantId: null,
        source: 'supabase-jwt',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_MEMBERSHIP_REQUIRED' });
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

    await expect(
      resolveTenantIdForUser({
        userId: 'owner-1',
        requestedTenantId: 'tenant-foreign',
        source: 'supabase-jwt',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_NOT_AUTHORIZED' });
  });

  it('resolveTenantIdForUser no crea membership desde jwtClaimTenantId', async () => {
    resetTenancyService();
    const { getTenancyService } = await import('../../backend/domains/tenancy/service');
    const svc = getTenancyService();
    const tenant = await svc.createTenant({
      name: 'Claim WISP',
      slug: 'claim-wisp',
    });

    await expect(
      resolveTenantIdForUser({
        userId: 'owner-claim',
        requestedTenantId: null,
        jwtClaimTenantId: tenant.id,
        source: 'supabase-jwt',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_MEMBERSHIP_REQUIRED' });
    await expect(svc.listAllMembershipsForUser('owner-claim')).resolves.toEqual([]);
  });

  it('resolveTenantIdForUser no eleva por x-tenant-id sin membership', async () => {
    resetTenancyService();
    const { getTenancyService } = await import('../../backend/domains/tenancy/service');
    const svc = getTenancyService();
    const foreign = await svc.createTenant({ name: 'Foreign', slug: 'foreign-wisp' });

    await expect(
      resolveTenantIdForUser({
        userId: 'stranger',
        requestedTenantId: foreign.id,
        source: 'supabase-jwt',
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'TENANT_NOT_AUTHORIZED' });
    expect(await svc.listMembershipsForUser('stranger')).toHaveLength(0);
  });
});
