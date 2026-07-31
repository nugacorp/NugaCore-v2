import type { AuthContext } from '../../common/auth-context';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { isLegacySingleWispFallbackEnabled } from './flags';
import { getTenancyService } from './service';
import { DEFAULT_TENANT_ID } from './types';

// ====================================================================
// Resolución de tenant FAIL-CLOSED (MT-02).
//
// Nunca devuelve un tenant "por si acaso". Cuando la pertenencia no puede
// demostrarse, devuelve una DENEGACIÓN tipada que el middleware traduce a
// 401/403 sin construir authContext, de modo que ningún repositorio ni
// handler llega a ejecutarse.
//
// Orden de concesión:
//   1. Header/`x-tenant-id` si el usuario tiene membresía ACTIVA en él.
//   2. Claim `app_metadata.tenant_id` del JWT (solo service_role puede
//      escribirlo) si el tenant existe: repara la membresía huérfana.
//   3. Primera membresía activa.
//   4. `tenant-default` SOLO con el gate legacy single-WISP encendido.
//
// Todo lo demás deniega.
// ====================================================================

export type TenantDenialCode =
  /** Fallo técnico: la pertenencia no se pudo verificar (DB caída, timeout). */
  | 'TENANT_RESOLUTION_UNAVAILABLE'
  /** El usuario no tiene ninguna membresía activa. */
  | 'TENANT_MEMBERSHIP_REQUIRED'
  /** Existe membresía pero está invited/suspended. */
  | 'TENANT_MEMBERSHIP_INACTIVE'
  /** Pidió un tenant en el que no es miembro activo. */
  | 'TENANT_NOT_AUTHORIZED';

export type TenantGrantVia =
  | 'requested-membership'
  | 'jwt-claim-membership'
  | 'jwt-claim-repair'
  | 'primary-membership'
  | 'legacy-single-wisp';

export interface TenantResolutionGranted {
  ok: true;
  tenantId: string;
  via: TenantGrantVia;
}

export interface TenantResolutionDenied {
  ok: false;
  /** 401 = no hay contexto verificable; 403 = hay identidad pero no permiso. */
  status: 401 | 403;
  code: TenantDenialCode;
  /** Mensaje seguro para el cliente: sin ids ni nombres de otro WISP. */
  message: string;
}

export type TenantResolution = TenantResolutionGranted | TenantResolutionDenied;

export interface ResolveTenantParams {
  userId: string;
  requestedTenantId?: string | null;
  /** Solo app_metadata.tenant_id del JWT (service_role). Nunca confiar el header aquí. */
  jwtClaimTenantId?: string | null;
  source: AuthContext['source'];
}

const DENIALS: Record<TenantDenialCode, { status: 401 | 403; message: string }> = {
  TENANT_RESOLUTION_UNAVAILABLE: {
    status: 401,
    message: 'No se pudo verificar la pertenencia al WISP. Inténtalo de nuevo.',
  },
  TENANT_MEMBERSHIP_REQUIRED: {
    status: 403,
    message: 'La cuenta no pertenece a ningún WISP activo.',
  },
  TENANT_MEMBERSHIP_INACTIVE: {
    status: 403,
    message: 'La membresía de la cuenta en este WISP no está activa.',
  },
  TENANT_NOT_AUTHORIZED: {
    status: 403,
    message: 'La cuenta no tiene acceso al WISP solicitado.',
  },
};

const deny = (code: TenantDenialCode): TenantResolutionDenied => ({
  ok: false,
  status: DENIALS[code].status,
  code,
  message: DENIALS[code].message,
});

const grant = (tenantId: string, via: TenantGrantVia): TenantResolutionGranted => ({
  ok: true,
  tenantId,
  via,
});

/**
 * Observabilidad saneada: distingue fallo técnico, ausencia de membresía y
 * denegación, sin filtrar datos de otro WISP. Solo se registran el userId, si
 * hubo un tenant solicitado y el motivo. Los errores técnicos se
 * clasifican por tipo, sin copiar mensajes crudos de DB a logs de aplicación.
 */
const logDenial = (
  denial: TenantResolutionDenied,
  params: ResolveTenantParams,
  detail?: unknown,
): TenantResolutionDenied => {
  const payload = {
    outcome: 'denied',
    code: denial.code,
    userId: params.userId,
    requestedTenantProvided: Boolean((params.requestedTenantId || '').trim()),
    source: params.source,
    ...(detail !== undefined
      ? { technicalErrorType: detail instanceof Error ? detail.name : typeof detail }
      : {}),
  };
  if (denial.code === 'TENANT_RESOLUTION_UNAVAILABLE') {
    logger.error('Tenant resolution failed (technical)', payload);
  } else {
    logger.warn('Tenant resolution denied', payload);
  }
  return denial;
};

export const resolveTenantForUser = async (
  params: ResolveTenantParams,
): Promise<TenantResolution> => {
  const service = getTenancyService();
  const userId = (params.userId || '').trim();
  const requested = (params.requestedTenantId || '').trim();
  const claim = (params.jwtClaimTenantId || '').trim();
  const legacyFallback = isLegacySingleWispFallbackEnabled();

  if (!userId) {
    return logDenial(deny('TENANT_MEMBERSHIP_REQUIRED'), params);
  }

  let activeMemberships;
  try {
    activeMemberships = await service.listMembershipsForUser(userId);
  } catch (err) {
    // Fallo técnico: el gate legacy NO rescata esto. Sin verificación no hay tenant.
    return logDenial(deny('TENANT_RESOLUTION_UNAVAILABLE'), params, err);
  }
  const activeTenantIds = new Set(activeMemberships.map((m) => m.tenantId));

  // ---- 1. Tenant pedido explícitamente (header x-tenant-id / claim) ----
  if (requested) {
    if (activeTenantIds.has(requested)) return grant(requested, 'requested-membership');

    let membership;
    try {
      membership = await service.getMembership(requested, userId);
    } catch (err) {
      return logDenial(deny('TENANT_RESOLUTION_UNAVAILABLE'), params, err);
    }
    if (membership) {
      return logDenial(deny('TENANT_MEMBERSHIP_INACTIVE'), params);
    }
    // Compatibilidad single-WISP: tenant-default explícito equivale al
    // fallback sin header, pero sólo si el usuario no tiene NINGUNA membership.
    // Nunca convierte otro x-tenant-id arbitrario en autorización.
    if (
      legacyFallback
      && requested === DEFAULT_TENANT_ID
      && activeMemberships.length === 0
    ) {
      let allMemberships;
      try {
        allMemberships = await service.listAllMembershipsForUser(userId);
      } catch (err) {
        return logDenial(deny('TENANT_RESOLUTION_UNAVAILABLE'), params, err);
      }
      if (allMemberships.length === 0) {
        return grant(DEFAULT_TENANT_ID, 'legacy-single-wisp');
      }
      return logDenial(deny('TENANT_MEMBERSHIP_INACTIVE'), params);
    }
    return logDenial(deny('TENANT_NOT_AUTHORIZED'), params);
  }

  // ---- 2. Claim del JWT (app_metadata, solo escribible por service_role) ----
  if (claim && params.source === 'supabase-jwt') {
    if (activeTenantIds.has(claim)) return grant(claim, 'jwt-claim-membership');

    let tenant;
    try {
      tenant = await service.getTenant(claim);
    } catch (err) {
      return logDenial(deny('TENANT_RESOLUTION_UNAVAILABLE'), params, err);
    }
    if (tenant) {
      try {
        await service.ensureMembership({
          tenantId: claim,
          userId,
          role: 'owner',
          status: 'active',
        });
      } catch (err) {
        // Sin membresía persistida no hay pertenencia demostrable: denegar.
        return logDenial(deny('TENANT_RESOLUTION_UNAVAILABLE'), params, err);
      }
      return grant(claim, 'jwt-claim-repair');
    }
  }

  // ---- 3. Primera membresía activa ----
  if (activeMemberships.length > 0) {
    return grant(activeMemberships[0].tenantId, 'primary-membership');
  }

  // ---- 4. Sin membresías activas: ¿inactiva o inexistente? ----
  let allMemberships;
  try {
    allMemberships = await service.listAllMembershipsForUser(userId);
  } catch (err) {
    return logDenial(deny('TENANT_RESOLUTION_UNAVAILABLE'), params, err);
  }
  if (allMemberships.length > 0) {
    return logDenial(deny('TENANT_MEMBERSHIP_INACTIVE'), params);
  }

  if (legacyFallback) return grant(DEFAULT_TENANT_ID, 'legacy-single-wisp');

  return logDenial(deny('TENANT_MEMBERSHIP_REQUIRED'), params);
};

/**
 * Adaptador para callers internos que todavía esperan un tenantId directo.
 * Mantiene la API previa, pero las denegaciones ahora son AppError 401/403 en
 * vez de degradarse a tenant-default.
 */
export const resolveTenantIdForUser = async (
  params: ResolveTenantParams,
): Promise<string> => {
  const resolution = await resolveTenantForUser(params);
  if (!resolution.ok) {
    throw new AppError(resolution.status, resolution.message, resolution.code);
  }
  return resolution.tenantId;
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
