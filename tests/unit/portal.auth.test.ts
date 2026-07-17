import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetById = vi.fn();

vi.mock('../../backend/services/supabase-admin', () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('../../backend/domains/customers/service', () => ({
  getCustomersService: () => ({
    getById: (...args: unknown[]) => mockGetById(...args),
  }),
}));

import { ForbiddenError } from '../../backend/common/errors';
import { resolvePortalAuth } from '../../backend/domains/portal/auth';

describe('portal auth', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    mockGetById.mockReset();
    delete process.env.PORTAL_STAGING_TOKEN;
    mockGetById.mockResolvedValue({ id: 'c-1', tenantId: 'tenant-a' });
  });

  const req = (overrides: Partial<Request> = {}): Request => ({
    params: { clientId: 'c-1' },
    headers: {},
    authContext: { userId: 'u', role: 'super admin', tenantId: 'tenant-staff', source: 'supabase-jwt' },
    ...overrides,
  } as Request);

  const mockRoleLookup = (roleName: string | null, binding?: { client_id: string; tenant_id?: string } | null) => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_roles') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: roleName ? { roles: { name: roleName } } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'portal_user_bindings') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: binding === undefined ? null : binding,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      };
    });
  };

  it('permite JWT staff con clientId en ruta y tenant del staff', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-staff', user_metadata: {}, app_metadata: {} } },
      error: null,
    });
    mockRoleLookup('super admin');

    const auth = await resolvePortalAuth(req({ headers: { authorization: 'Bearer staff-jwt' } }));
    expect(auth.mode).toBe('jwt-staff');
    expect(auth.clientId).toBe('c-1');
    expect(auth.tenantId).toBe('tenant-staff');
  });

  it('rechaza JWT cliente si clientId no coincide', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-client', user_metadata: { client_id: 'c-2' }, app_metadata: {} } },
      error: null,
    });
    mockRoleLookup(null);

    await expect(
      resolvePortalAuth(req({ params: { clientId: 'c-1' }, headers: { authorization: 'Bearer client-jwt' } })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('acepta JWT cliente vinculado por metadata y resuelve tenant del client', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-client', user_metadata: { client_id: 'c-1' }, app_metadata: {} } },
      error: null,
    });
    mockRoleLookup(null);

    const auth = await resolvePortalAuth(req({ headers: { authorization: 'Bearer client-jwt' } }));
    expect(auth.mode).toBe('jwt-client');
    expect(auth.clientId).toBe('c-1');
    expect(auth.tenantId).toBe('tenant-a');
    expect(mockGetById).toHaveBeenCalledWith('c-1');
  });

  it('acepta JWT cliente con tenant desde portal_user_bindings', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-client', user_metadata: {}, app_metadata: {} } },
      error: null,
    });
    mockRoleLookup(null, { client_id: 'c-1', tenant_id: 'tenant-bound' });

    const auth = await resolvePortalAuth(req({ headers: { authorization: 'Bearer client-jwt' } }));
    expect(auth.mode).toBe('jwt-client');
    expect(auth.clientId).toBe('c-1');
    expect(auth.tenantId).toBe('tenant-bound');
    expect(mockGetById).not.toHaveBeenCalled();
  });

  it('requiere staging token cuando PORTAL_STAGING_TOKEN está configurado sin JWT', async () => {
    process.env.PORTAL_STAGING_TOKEN = 'secret-portal';
    await expect(resolvePortalAuth(req())).rejects.toMatchObject({ code: 'PORTAL_UNAUTHORIZED' });
  });
});
