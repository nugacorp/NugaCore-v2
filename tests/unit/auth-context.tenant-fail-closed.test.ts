import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../backend/common/logger';
import { requireRoles } from '../../backend/common/rbac';
import {
  resolveTenantForUser,
  resolveTenantIdForUser,
  type TenantResolutionDenied,
} from '../../backend/domains/tenancy/resolve-tenant';
import { getTenancyService, resetTenancyService } from '../../backend/domains/tenancy/service';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

const ENV_KEYS = ['LEGACY_SINGLE_WISP_FALLBACK', 'PUBLIC_DEPLOYMENT', 'NODE_ENV', 'USE_DB_TENANCY'] as const;
const savedEnv: Record<string, string | undefined> = {};

const withAuthFailure = (failure: TenantResolutionDenied) => {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const next = vi.fn();
  const req = { authContextFailure: failure } as unknown as Request;
  const res = { status, json } as unknown as Response;

  requireRoles(['administrador'])(req, res, next);

  return { status, json, next };
};

describe('attachAuthContext / tenancy fail-closed integration', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    delete process.env.LEGACY_SINGLE_WISP_FALLBACK;
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

  it('deniega un usuario sin memberships y no concede tenant-default', async () => {
    const result = await resolveTenantForUser({
      userId: 'user-sin-wisp',
      source: 'trusted-headers',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(403);
    expect(result.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    expect(JSON.stringify(result)).not.toContain(DEFAULT_TENANT_ID);
  });

  it('un fallo tecnico de tenancy queda como denegacion tipada y se registra como error', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(getTenancyService(), 'listMembershipsForUser').mockRejectedValue(new Error('db down'));

    const result = await resolveTenantForUser({
      userId: 'user-a',
      source: 'supabase-jwt',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(401);
    expect(result.code).toBe('TENANT_RESOLUTION_UNAVAILABLE');
    expect(result.message).not.toContain('db down');
    expect(error).toHaveBeenCalledWith(
      'Tenant resolution failed (technical)',
      expect.objectContaining({
        code: 'TENANT_RESOLUTION_UNAVAILABLE',
        outcome: 'denied',
      }),
    );
  });

  it('resolveTenantIdForUser convierte denegaciones en AppError sin fallback silencioso', async () => {
    await expect(
      resolveTenantIdForUser({
        userId: 'user-sin-wisp',
        source: 'supabase-jwt',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'TENANT_MEMBERSHIP_REQUIRED',
    });
  });

  it('los guards HTTP usan authContextFailure y no ejecutan el handler protegido', async () => {
    const result = await resolveTenantForUser({
      userId: 'user-sin-wisp',
      source: 'trusted-headers',
    });
    if (result.ok) throw new Error('expected denial');

    const { status, json, next } = withAuthFailure(result);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: result.message,
      code: 'TENANT_MEMBERSHIP_REQUIRED',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('el fallback single-WISP solo existe detras del gate legacy explicito', async () => {
    process.env.LEGACY_SINGLE_WISP_FALLBACK = 'true';

    const result = await resolveTenantForUser({
      userId: 'user-legacy',
      source: 'trusted-headers',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(result.ok && result.via).toBe('legacy-single-wisp');
  });
});
