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

/** Extrae mensaje útil de errores PostgREST/objetos no-Error. */
export const dbErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message || 'Unknown DB error');
  }
  return String(error || 'Unknown DB error');
};

/**
 * True cuando PostgREST/Postgres reporta que falta la columna tenant_id
 * (migración SSOT aún no aplicada en ese entorno).
 */
export const isMissingTenantIdColumnError = (error: unknown): boolean => {
  const msg = dbErrorMessage(error);
  return /tenant_id/i.test(msg) && /does not exist|could not find/i.test(msg);
};

/** Cache por tabla: null=desconocido, true=columna OK, false=ausente. */
const tenantColumnReady = new Map<string, boolean>();

export const getTenantColumnReady = (table: string): boolean | null =>
  tenantColumnReady.has(table) ? tenantColumnReady.get(table)! : null;

export const setTenantColumnReady = (table: string, ready: boolean): void => {
  tenantColumnReady.set(table, ready);
};

/** Quita tenant_id del payload de insert/update cuando la columna aún no existe. */
export const stripTenantIdIfUnsupported = <T extends Record<string, unknown>>(
  table: string,
  row: T,
): T => {
  if (getTenantColumnReady(table) === false && 'tenant_id' in row) {
    const { tenant_id: _omit, ...rest } = row;
    return rest as T;
  }
  return row;
};
