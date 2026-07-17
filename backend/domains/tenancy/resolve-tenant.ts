import type { AuthContext } from '../../common/auth-context';
import { logger } from '../../common/logger';
import { isHardenedRuntime } from '../../config/env';
import { getTenancyService } from './service';
import { DEFAULT_TENANT_ID } from './types';

/**
 * Resuelve el tenant activo para un usuario.
 *
 * Orden:
 * 1. Header/claim `x-tenant-id` / app_metadata si el usuario es miembro
 * 2. JWT app_metadata.tenant_id si el tenant existe (repara membership huérfana)
 * 3. Primera membresía activa
 * 4. DEFAULT_TENANT_ID (legacy single-WISP / staging sin memberships)
 *
 * Nota: ya no se apaga por MULTI_TENANT_ENABLED — los WISP nuevos deben
 * resolver siempre su tenant para no mezclar datos. El flag solo documenta
 * el modo operativo en /api/tenancy/status.
 */
export const resolveTenantIdForUser = async (params: {
  userId: string;
  requestedTenantId?: string | null;
  /** Solo app_metadata.tenant_id del JWT (service_role). Nunca confiar el header aquí. */
  jwtClaimTenantId?: string | null;
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

  // Claim JWT: si el tenant existe pero falta membership (registro parcial), reparar.
  const claim = (params.jwtClaimTenantId || '').trim();
  if (claim && params.source === 'supabase-jwt') {
    if (memberTenantIds.has(claim)) return claim;
    const tenant = await service.getTenant(claim);
    if (tenant) {
      try {
        await service.ensureMembership({
          tenantId: claim,
          userId: params.userId,
          role: 'owner',
          status: 'active',
        });
      } catch (err) {
        logger.warn('No se pudo reparar membership para claim de tenant', {
          tenantId: claim,
          userId: params.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return claim;
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
