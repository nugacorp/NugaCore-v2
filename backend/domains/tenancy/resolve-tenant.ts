import type { AuthContext } from '../../common/auth-context';
import { isHardenedRuntime } from '../../config/env';
import { getTenancyService } from './service';
import { DEFAULT_TENANT_ID } from './types';

/**
 * Resuelve el tenant activo para un usuario.
 *
 * Orden:
 * 1. Header/claim `x-tenant-id` / app_metadata si el usuario es miembro
 * 2. Primera membresía activa
 * 3. DEFAULT_TENANT_ID (legacy single-WISP / staging sin memberships)
 *
 * Nota: ya no se apaga por MULTI_TENANT_ENABLED — los WISP nuevos deben
 * resolver siempre su tenant para no mezclar datos. El flag solo documenta
 * el modo operativo en /api/tenancy/status.
 */
export const resolveTenantIdForUser = async (params: {
  userId: string;
  requestedTenantId?: string | null;
  source: AuthContext['source'];
}): Promise<string> => {
  const service = getTenancyService();
  const memberships = await service.listMembershipsForUser(params.userId);
  const memberTenantIds = new Set(memberships.map((m) => m.tenantId));

  const requested = (params.requestedTenantId || '').trim();
  if (requested) {
    if (memberTenantIds.has(requested)) return requested;
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
