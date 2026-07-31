// ====================================================================
// MT-02 — La resolución de tenant es FAIL-CLOSED.
//
// Ningún fallo (DB caída, cero memberships, membership inactiva, header
// de tenant ajeno) puede terminar en `tenant-default`. El único camino
// que conserva el fallback single-WISP es el gate legacy explícito, y
// ese gate NO puede encenderse en runtime endurecido.
// ====================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../backend/common/logger';
import {
  computeLegacySingleWispFallback,
  isLegacySingleWispFallbackEnabled,
  LEGACY_SINGLE_WISP_FALLBACK_ENV,
} from '../../backend/domains/tenancy/flags';
import { resolveTenantForUser } from '../../backend/domains/tenancy/resolve-tenant';
import { getTenancyService, resetTenancyService } from '../../backend/domains/tenancy/service';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

const ENV_KEYS = [LEGACY_SINGLE_WISP_FALLBACK_ENV, 'PUBLIC_DEPLOYMENT', 'NODE_ENV', 'USE_DB_TENANCY'] as const;
const savedEnv: Record<string, string | undefined> = {};

const seedTenants = async () => {
  const svc = getTenancyService();
  const a = await svc.createTenant({ name: 'WISP A', slug: 'wisp-a', ownerUserId: 'user-a' });
  const b = await svc.createTenant({ name: 'WISP B', slug: 'wisp-b', ownerUserId: 'user-b' });
  return { svc, a, b };
};

describe('MT-02 · resolveTenantForUser fail-closed', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    delete process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV];
    process.env.PUBLIC_DEPLOYMENT = 'false';
    process.env.NODE_ENV = 'test';
    process.env.USE_DB_TENANCY = 'false';
    resetTenancyService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetTenancyService();
  });

  // ---------------- Tenant A vs Tenant B ----------------

  it('usuario con membership en A resuelve A sin header', async () => {
    const { a } = await seedTenants();
    const result = await resolveTenantForUser({ userId: 'user-a', source: 'supabase-jwt' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.tenantId).toBe(a.id);
  });

  it('usuario con membership en A y header A resuelve A', async () => {
    const { a } = await seedTenants();
    const result = await resolveTenantForUser({
      userId: 'user-a',
      requestedTenantId: a.id,
      source: 'supabase-jwt',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.tenantId).toBe(a.id);
  });

  it('usuario de A pidiendo el tenant B es DENEGADO con 403 (nunca tenant-default)', async () => {
    const { b } = await seedTenants();
    const result = await resolveTenantForUser({
      userId: 'user-a',
      requestedTenantId: b.id,
      source: 'supabase-jwt',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(403);
    expect(result.code).toBe('TENANT_NOT_AUTHORIZED');
    // Observabilidad saneada: el mensaje no filtra datos del otro WISP.
    expect(result.message).not.toContain(b.id);
    expect(result.message).not.toContain('WISP B');
  });

  it('la observabilidad de una denegación no registra el tenant ajeno solicitado', async () => {
    const { b } = await seedTenants();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await resolveTenantForUser({
      userId: 'user-a',
      requestedTenantId: b.id,
      source: 'supabase-jwt',
    });

    expect(JSON.stringify(warn.mock.calls)).not.toContain(b.id);
  });

  it('header de tenant ajeno tampoco se acepta vía trusted-headers en runtime endurecido', async () => {
    process.env.PUBLIC_DEPLOYMENT = 'true';
    const { b } = await seedTenants();
    const result = await resolveTenantForUser({
      userId: 'user-a',
      requestedTenantId: b.id,
      source: 'trusted-headers',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(403);
  });

  // ---------------- Cero memberships ----------------

  it('usuario sin memberships es DENEGADO con 403 y no recibe tenant-default', async () => {
    await seedTenants();
    const result = await resolveTenantForUser({ userId: 'user-sin-wisp', source: 'supabase-jwt' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(403);
    expect(result.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    expect(JSON.stringify(result)).not.toContain(DEFAULT_TENANT_ID);
  });

  // ---------------- Membership inactiva ----------------

  it('membership inactiva es DENEGADA con 403 y código propio', async () => {
    const { svc, a } = await seedTenants();
    await svc.ensureMembership({
      tenantId: a.id,
      userId: 'user-suspendido',
      role: 'member',
      status: 'suspended',
    });

    const sinHeader = await resolveTenantForUser({
      userId: 'user-suspendido',
      source: 'supabase-jwt',
    });
    expect(sinHeader.ok).toBe(false);
    if (sinHeader.ok) throw new Error('unreachable');
    expect(sinHeader.status).toBe(403);
    expect(sinHeader.code).toBe('TENANT_MEMBERSHIP_INACTIVE');

    const conHeader = await resolveTenantForUser({
      userId: 'user-suspendido',
      requestedTenantId: a.id,
      source: 'supabase-jwt',
    });
    expect(conHeader.ok).toBe(false);
    if (conHeader.ok) throw new Error('unreachable');
    expect(conHeader.code).toBe('TENANT_MEMBERSHIP_INACTIVE');
  });

  // ---------------- Fallo de DB ----------------

  it('fallo de DB al listar memberships es DENEGADO con 401 técnico', async () => {
    await seedTenants();
    const svc = getTenancyService();
    vi.spyOn(svc, 'listMembershipsForUser').mockRejectedValue(
      new Error('Tenancy DB error (listMembershipsByUser): connection refused'),
    );

    const result = await resolveTenantForUser({ userId: 'user-a', source: 'supabase-jwt' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
    expect(result.code).toBe('TENANT_RESOLUTION_UNAVAILABLE');
    // El detalle técnico no viaja al cliente.
    expect(result.message).not.toContain('connection refused');
  });

  it('el gate legacy NO rescata un fallo técnico de DB', async () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';
    await seedTenants();
    const svc = getTenancyService();
    vi.spyOn(svc, 'listMembershipsForUser').mockRejectedValue(new Error('db down'));

    const result = await resolveTenantForUser({ userId: 'user-a', source: 'supabase-jwt' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('TENANT_RESOLUTION_UNAVAILABLE');
  });

  it('fallo de DB al reparar membership desde el claim JWT también deniega', async () => {
    const { svc, a } = await seedTenants();
    vi.spyOn(svc, 'ensureMembership').mockRejectedValue(new Error('insert failed'));

    const result = await resolveTenantForUser({
      userId: 'user-nuevo',
      jwtClaimTenantId: a.id,
      source: 'supabase-jwt',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('TENANT_RESOLUTION_UNAVAILABLE');
  });

  // ---------------- Claim JWT (app_metadata, service_role) ----------------

  it('claim JWT de un tenant existente repara la membership y resuelve ese tenant', async () => {
    const { a } = await seedTenants();
    const result = await resolveTenantForUser({
      userId: 'owner-huerfano',
      jwtClaimTenantId: a.id,
      source: 'supabase-jwt',
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.tenantId).toBe(a.id);
  });

  it('claim JWT de un tenant inexistente NO concede acceso', async () => {
    await seedTenants();
    const result = await resolveTenantForUser({
      userId: 'user-sin-wisp',
      jwtClaimTenantId: 'tenant-fantasma',
      source: 'supabase-jwt',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(403);
  });

  it('el claim JWT no sirve para el camino trusted-headers', async () => {
    const { a } = await seedTenants();
    const result = await resolveTenantForUser({
      userId: 'user-sin-wisp',
      jwtClaimTenantId: a.id,
      source: 'trusted-headers',
    });
    expect(result.ok).toBe(false);
  });
});

// ====================================================================
// Gate legacy single-WISP
// ====================================================================
describe('MT-02 · gate LEGACY_SINGLE_WISP_FALLBACK', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    delete process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV];
    process.env.PUBLIC_DEPLOYMENT = 'false';
    process.env.NODE_ENV = 'test';
    process.env.USE_DB_TENANCY = 'false';
    resetTenancyService();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetTenancyService();
  });

  it('el nombre del gate es LEGACY_SINGLE_WISP_FALLBACK', () => {
    expect(LEGACY_SINGLE_WISP_FALLBACK_ENV).toBe('LEGACY_SINGLE_WISP_FALLBACK');
  });

  it('requiere configuración afirmativa: ausente, vacío o "false" → apagado', () => {
    expect(computeLegacySingleWispFallback(false, undefined)).toBe(false);
    expect(computeLegacySingleWispFallback(false, '')).toBe(false);
    expect(computeLegacySingleWispFallback(false, 'false')).toBe(false);
    expect(computeLegacySingleWispFallback(false, '1')).toBe(false);
    expect(computeLegacySingleWispFallback(false, 'yes')).toBe(false);
    expect(computeLegacySingleWispFallback(false, 'true')).toBe(true);
    expect(computeLegacySingleWispFallback(false, ' TRUE ')).toBe(true);
  });

  it('runtime endurecido lo apaga SIEMPRE, aunque esté en "true"', () => {
    expect(computeLegacySingleWispFallback(true, 'true')).toBe(false);
    expect(computeLegacySingleWispFallback(true, ' TRUE ')).toBe(false);
    expect(computeLegacySingleWispFallback(true, undefined)).toBe(false);
  });

  it('NODE_ENV=production apaga el gate en runtime', () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';
    process.env.NODE_ENV = 'production';
    expect(isLegacySingleWispFallbackEnabled()).toBe(false);
  });

  it('PUBLIC_DEPLOYMENT=true apaga el gate en runtime', () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';
    process.env.PUBLIC_DEPLOYMENT = 'true';
    expect(isLegacySingleWispFallbackEnabled()).toBe(false);
  });

  it('con el gate encendido y runtime no endurecido, cero memberships cae a tenant-default', async () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';
    expect(isLegacySingleWispFallbackEnabled()).toBe(true);

    const result = await resolveTenantForUser({ userId: 'user-legacy', source: 'trusted-headers' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(result.ok && result.via).toBe('legacy-single-wisp');
  });

  it('el gate legacy no autoriza un header de tenant arbitrario', async () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';

    const result = await resolveTenantForUser({
      userId: 'user-legacy',
      requestedTenantId: 'tenant-no-autorizado',
      source: 'trusted-headers',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('TENANT_NOT_AUTHORIZED');
  });

  it('el gate legacy acepta tenant-default explícito sólo sin memberships', async () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';

    const result = await resolveTenantForUser({
      userId: 'user-legacy',
      requestedTenantId: DEFAULT_TENANT_ID,
      source: 'trusted-headers',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(result.ok && result.via).toBe('legacy-single-wisp');
  });

  it('userCanAccessTenant no rescata una membership inactiva con tenant-default', async () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';
    const { svc, a } = await seedTenants();
    await svc.ensureMembership({
      tenantId: a.id,
      userId: 'user-suspendido-legacy',
      role: 'member',
      status: 'suspended',
    });

    await expect(
      svc.userCanAccessTenant('user-suspendido-legacy', DEFAULT_TENANT_ID),
    ).resolves.toBe(false);
  });

  it('con el gate encendido pero runtime endurecido, cero memberships DENIEGA', async () => {
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV] = 'true';
    process.env.PUBLIC_DEPLOYMENT = 'true';

    const result = await resolveTenantForUser({ userId: 'user-legacy', source: 'trusted-headers' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
  });
});
