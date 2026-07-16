import type { AuthContext } from '../../common/auth-context';
import { isHardenedRuntime } from '../../config/env';
import { isMultiTenantEnabled } from './flags';
import { getTenancyService } from './service';
import { DEFAULT_TENANT_ID } from './types';

/**
 * Resuelve el tenant activo para un usuario.
 *
 * Orden:
 * 1. Si multi-tenant OFF → siempre DEFAULT_TENANT_ID
 * 2. Header `x-tenant-id` si el usuario es miembro (o trusted-headers en dev)
 * 3. Primera membresía activa del usuario
 * 4. DEFAULT_TENANT_ID
 */
export const resolveTenantIdForUser = async (params: {
  userId: string;
  requestedTenantId?: string | null;
  source: AuthContext['source'];
}): Promise<string> => {
  if (!isMultiTenantEnabled()) {
    return DEFAULT_TENANT_ID;
  }

  const service = getTenancyService();
  const memberships = await service.listMembershipsForUser(params.userId);
  const memberTenantIds = new Set(memberships.map((m) => m.tenantId));

  const requested = (params.requestedTenantId || '').trim();
  if (requested) {
    if (memberTenantIds.has(requested)) return requested;
    // En trusted-headers (dev) permitir override explícito para pruebas.
    if (params.source === 'trusted-headers' && !isHardenedRuntime) {
      return requested;
    }
  }

  if (memberships.length > 0) return memberships[0].tenantId;
  return DEFAULT_TENANT_ID;
};

/** Extrae x-tenant-id del request (string o array). */
export const readRequestedTenantId = (
  header: string | string[] | undefined,
): string | null => {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  const value = String(raw || '').trim();
  return value || null;
};
