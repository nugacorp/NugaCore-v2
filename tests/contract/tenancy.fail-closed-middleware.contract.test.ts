// ====================================================================
// MT-02 — Contrato HTTP: sin tenant resoluble no hay contexto autorizado.
//
// Comprueba de punta a punta que `attachAuthContext` NO fabrica un
// contexto con `tenant-default` y que las rutas protegidas responden
// 401/403 SIN ejecutar un solo repositorio ni handler con efecto.
// ====================================================================

import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Debe correr ANTES de los imports del backend: `allowTrustedHeaders` y los
// singletons se calculan al cargar el módulo.
const savedEnv = vi.hoisted(() => {
  const keys = ['USE_DB_TENANCY', 'AUTH_TRUST_HEADERS', 'LEGACY_SINGLE_WISP_FALLBACK', 'PUBLIC_DEPLOYMENT'];
  const saved: Record<string, string | undefined> = {};
  for (const key of keys) saved[key] = process.env[key];
  process.env.USE_DB_TENANCY = 'false';
  // Trusted-headers ENCENDIDOS a propósito: una denegación del camino JWT no
  // puede ser "rescatada" por el fallback de cabeceras de desarrollo.
  process.env.AUTH_TRUST_HEADERS = 'true';
  delete process.env.LEGACY_SINGLE_WISP_FALLBACK;
  process.env.PUBLIC_DEPLOYMENT = 'false';
  return saved;
});

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../backend/services/supabase-admin', () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// El wizard de onboarding no es objeto de esta prueba: se declara completo.
vi.mock('../../backend/domains/wisp-onboarding/service', () => ({
  getWispOnboardingService: () => ({
    isOnboardingRequired: async () => false,
    getStatus: async () => null,
  }),
}));

import { createApp } from '../../backend/app';
import { getCustomersService } from '../../backend/domains/customers/service';
import { getTenancyService, resetTenancyService } from '../../backend/domains/tenancy/service';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

const USERS: Record<string, { id: string; tenantClaim?: string }> = {
  'token-a': { id: 'user-a' },
  'token-b': { id: 'user-b' },
  'token-huerfano': { id: 'user-huerfano' },
  'token-suspendido': { id: 'user-suspendido' },
  'token-a-claim': { id: 'user-a' },
  'token-huerfano-claim': { id: 'user-huerfano-claim' },
  'token-invitado-claim': { id: 'user-invitado-claim' },
  'token-suspendido-claim': { id: 'user-suspendido-claim' },
};

const app = createApp();
let tenantA = '';
let tenantB = '';

describe('MT-02 · contrato fail-closed de resolución de tenant', () => {
  beforeEach(async () => {
    mockFrom.mockReset();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_roles') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { roles: { name: 'administrador' } }, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    });

    mockGetUser.mockReset();
    mockGetUser.mockImplementation(async (token: string) => {
      const user = USERS[token];
      if (!user) return { data: { user: null }, error: { message: 'invalid token' } };
      return {
        data: {
          user: {
            id: user.id,
            app_metadata: user.tenantClaim ? { tenant_id: user.tenantClaim } : {},
          },
        },
        error: null,
      };
    });

    delete process.env.LEGACY_SINGLE_WISP_FALLBACK;
    resetTenancyService();
    const svc = getTenancyService();
    tenantA = (await svc.createTenant({ name: 'WISP A', slug: 'wisp-a', ownerUserId: 'user-a' })).id;
    tenantB = (await svc.createTenant({ name: 'WISP B', slug: 'wisp-b', ownerUserId: 'user-b' })).id;
    USERS['token-a-claim'].tenantClaim = tenantA;
    USERS['token-huerfano-claim'].tenantClaim = tenantA;
    USERS['token-invitado-claim'].tenantClaim = tenantA;
    USERS['token-suspendido-claim'].tenantClaim = tenantA;
    await svc.ensureMembership({
      tenantId: tenantA,
      userId: 'user-suspendido',
      role: 'member',
      status: 'suspended',
    });
    await svc.ensureMembership({
      tenantId: tenantA,
      userId: 'user-invitado-claim',
      role: 'member',
      status: 'invited',
    });
    await svc.ensureMembership({
      tenantId: tenantA,
      userId: 'user-suspendido-claim',
      role: 'member',
      status: 'suspended',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetTenancyService();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // ---------------- Camino feliz A/B ----------------

  it('el usuario de A lee con el tenant A (nunca tenant-default)', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer token-a');

    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0].tenantId).toBe(tenantA);
    expect(list.mock.calls[0][0].tenantId).not.toBe(DEFAULT_TENANT_ID);
  });

  it('cada usuario queda en su propio tenant (A ≠ B)', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    await request(app).get('/api/clients').set('Authorization', 'Bearer token-a').expect(200);
    await request(app).get('/api/clients').set('Authorization', 'Bearer token-b').expect(200);

    expect(list.mock.calls[0][0].tenantId).toBe(tenantA);
    expect(list.mock.calls[1][0].tenantId).toBe(tenantB);
  });

  it('JWT claim A selecciona A sólo con membership A activa', async () => {
    const svc = getTenancyService();
    const ensureMembership = vi.spyOn(svc, 'ensureMembership');
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer token-a-claim');

    expect(res.status).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0].tenantId).toBe(tenantA);
    expect(ensureMembership).not.toHaveBeenCalled();
  });

  it.each([
    ['invited', 'token-invitado-claim'],
    ['suspended', 'token-suspendido-claim'],
  ] as const)('JWT claim con membership %s devuelve 403 y cero side effects', async (_status, token) => {
    const svc = getTenancyService();
    const ensureMembership = vi.spyOn(svc, 'ensureMembership');
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app).get('/api/clients').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_MEMBERSHIP_INACTIVE');
    expect(ensureMembership).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('JWT claim con cero memberships devuelve 403 sin crear contexto ni filas', async () => {
    const svc = getTenancyService();
    const ensureMembership = vi.spyOn(svc, 'ensureMembership');
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', 'Bearer token-huerfano-claim');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    expect(ensureMembership).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    await expect(svc.listAllMembershipsForUser('user-huerfano-claim')).resolves.toEqual([]);
  });

  // ---------------- Header de tenant no autorizado ----------------

  it('403 y CERO repositorios si el usuario de A pide el tenant B', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', 'Bearer token-a')
      .set('x-tenant-id', tenantB);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_NOT_AUTHORIZED');
    expect(list).not.toHaveBeenCalled();
  });

  // ---------------- Cero memberships ----------------

  it('403 sin memberships y sin tocar el repositorio', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer token-huerfano');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    expect(JSON.stringify(res.body)).not.toContain(DEFAULT_TENANT_ID);
    expect(list).not.toHaveBeenCalled();
  });

  // ---------------- Membership inactiva ----------------

  it('403 con membership inactiva', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer token-suspendido');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_MEMBERSHIP_INACTIVE');
    expect(list).not.toHaveBeenCalled();
  });

  // ---------------- Fallo de DB ----------------

  it('401 ante fallo de DB del resolver, sin ejecutar el repositorio', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);
    vi.spyOn(getTenancyService(), 'listMembershipsForUser').mockRejectedValue(
      new Error('Tenancy DB error (listMembershipsByUser): connection refused'),
    );

    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer token-a');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TENANT_RESOLUTION_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
    expect(list).not.toHaveBeenCalled();
  });

  // ---------------- Cero side effects en escrituras ----------------

  it('la escritura denegada no crea nada (cero side effects del handler)', async () => {
    const create = vi.spyOn(getCustomersService(), 'create');
    const generateId = vi.spyOn(getCustomersService(), 'generateClientId');

    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', 'Bearer token-huerfano')
      .send({ name: 'Cliente Fantasma', type: 'residencial', address: 'Calle 1', city: 'CDMX' });

    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(generateId).not.toHaveBeenCalled();
  });

  // ---------------- El fallback de trusted-headers no rescata ----------------

  it('un JWT denegado NO cae al fallback de trusted-headers', async () => {
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app)
      .get('/api/clients')
      .set('Authorization', 'Bearer token-huerfano')
      .set('x-user-role', 'super admin')
      .set('x-user-id', 'user-huerfano');

    expect(res.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  // ---------------- Las rutas públicas siguen vivas ----------------

  it('la denegación de tenant no rompe las rutas públicas', async () => {
    const res = await request(app).get('/api/health').set('Authorization', 'Bearer token-huerfano');
    expect(res.status).toBe(200);
  });

  // ---------------- Gate legacy ----------------

  it('con el gate legacy encendido (runtime no endurecido) el usuario sin membership vuelve a tenant-default', async () => {
    process.env.LEGACY_SINGLE_WISP_FALLBACK = 'true';
    const list = vi.spyOn(getCustomersService(), 'list').mockResolvedValue([]);

    const res = await request(app).get('/api/clients').set('Authorization', 'Bearer token-huerfano');

    expect(res.status).toBe(200);
    expect(list.mock.calls[0][0].tenantId).toBe(DEFAULT_TENANT_ID);
  });
});
