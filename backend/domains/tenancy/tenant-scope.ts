import type { Request } from 'express';
import { DEFAULT_TENANT_ID } from './types';

/**
 * Tenant activo del request (rellenado por attachAuthContext).
 * Fallback a DEFAULT_TENANT_ID para compatibilidad single-WISP.
 */
export const tenantIdFromRequest = (req: Request): string =>
  req.authContext?.tenantId || DEFAULT_TENANT_ID;

/**
 * Aplica filtro de tenant en queries Supabase cuando hay tenantId.
 */
export const applyTenantEq = <T extends { eq: (column: string, value: string) => T }>(
  query: T,
  tenantId: string | undefined | null,
): T => {
  if (!tenantId) return query;
  return query.eq('tenant_id', tenantId);
};

/** Tenant efectivo de un registro (legacy sin stamp → tenant-default). */
export const resolveRecordTenantId = (tenantId: string | undefined | null): string =>
  tenantId || DEFAULT_TENANT_ID;

export const belongsToTenant = (
  recordTenantId: string | undefined | null,
  tenantId: string,
): boolean => resolveRecordTenantId(recordTenantId) === tenantId;
