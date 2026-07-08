import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('../../backend/services/supabase-admin', () => ({
  isSupabaseAdminConfigured: true,
  supabaseAdmin: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { ForbiddenError, UnauthorizedError } from '../../backend/common/errors';
import { resolvePortalAuth } from '../../backend/domains/portal/auth';

describe('portal auth', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    delete process.env.PORTAL_STAGING_TOKEN;
  });

  const req = (overrides: Partial<Request> = {}): Request => ({
    params: { clientId: 'c-1' },
    headers: {},
    ...overrides,
  } as Request);

  const mockRoleLookup = (roleName: string | null) => {
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
                maybeSingle: async () => ({ data: null, error: null }),
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

  it('permite JWT staff con clientId en ruta', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-staff', user_metadata: {}, app_metadata: {} } },
      error: null,
    });
    mockRoleLookup('super admin');

    const auth = await resolvePortalAuth(req({ headers: { authorization: 'Bearer staff-jwt' } }));
    expect(auth.mode).toBe('jwt-staff');
    expect(auth.clientId).toBe('c-1');
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

  it('acepta JWT cliente vinculado por metadata', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u-client', user_metadata: { client_id: 'c-1' }, app_metadata: {} } },
      error: null,
    });
    mockRoleLookup(null);

    const auth = await resolvePortalAuth(req({ headers: { authorization: 'Bearer client-jwt' } }));
    expect(auth.mode).toBe('jwt-client');
    expect(auth.clientId).toBe('c-1');
  });

  it('requiere staging token cuando PORTAL_STAGING_TOKEN está configurado sin JWT', async () => {
    process.env.PORTAL_STAGING_TOKEN = 'secret-portal';
    await expect(resolvePortalAuth(req())).rejects.toMatchObject({ code: 'PORTAL_UNAUTHORIZED' });
  });
});
