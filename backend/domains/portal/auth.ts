import { Request } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../common/errors';
import { AppRole, normalizeRole } from '../../common/rbac';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { getCustomersService } from '../customers/service';
import { DEFAULT_TENANT_ID } from '../tenancy/types';
import { resolveRecordTenantId, tenantIdFromRequest } from '../tenancy/tenant-scope';

export type PortalAuthMode = 'jwt-client' | 'jwt-staff' | 'staging-token' | 'open';

export interface PortalAuthContext {
  clientId: string;
  tenantId: string;
  mode: PortalAuthMode;
  userId?: string;
  role?: AppRole;
}

const STAFF_ROLES: AppRole[] = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'];

const extractBearerToken = (value: string | undefined): string | null => {
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
};

const portalTokenConfigured = (): boolean =>
  (process.env.PORTAL_STAGING_TOKEN || '').trim().length > 0;

const resolveRoleFromSupabase = async (userId: string): Promise<AppRole | null> => {
  if (!supabaseAdmin) return null;
  const { data: mappedRole } = await supabaseAdmin
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  const roleName = ((mappedRole as { roles?: { name?: string } } | null)?.roles?.name || '').trim();
  return normalizeRole(roleName);
};

const readMetadataClientId = (user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }): string | null => {
  const fromUser = String(user.user_metadata?.client_id || user.user_metadata?.clientId || '').trim();
  if (fromUser) return fromUser;
  const fromApp = String(user.app_metadata?.client_id || user.app_metadata?.clientId || '').trim();
  return fromApp || null;
};

type BoundClient = { clientId: string; tenantId?: string };

const resolveBoundClient = async (
  userId: string,
  user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> },
): Promise<BoundClient | null> => {
  const fromMeta = readMetadataClientId(user);
  if (fromMeta) return { clientId: fromMeta };

  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('portal_user_bindings')
    .select('client_id, tenant_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error || !data?.client_id) return null;
  const bindingTenant = data.tenant_id ? String(data.tenant_id).trim() : '';
  return {
    clientId: String(data.client_id),
    tenantId: bindingTenant || undefined,
  };
};

/** Tenant del portal cliente: binding → client.tenantId → default. */
const resolveClientPortalTenantId = async (bound: BoundClient): Promise<string> => {
  if (bound.tenantId) return resolveRecordTenantId(bound.tenantId);
  const client = await getCustomersService().getById(bound.clientId);
  return resolveRecordTenantId(client?.tenantId);
};

const assertStagingToken = (req: Request): void => {
  const expected = (process.env.PORTAL_STAGING_TOKEN || '').trim();
  if (!expected) return;
  const provided = String(req.headers['x-portal-token'] || '').trim();
  if (provided !== expected) {
    throw new UnauthorizedError('Invalid portal token', 'PORTAL_UNAUTHORIZED');
  }
};

/**
 * Resuelve acceso al portal:
 * - JWT cliente: clientId del token debe coincidir con :clientId; tenant desde binding/client
 * - JWT staff: preview del :clientId dentro del tenant del staff (tenantIdFromRequest)
 * - Staging token: x-portal-token si PORTAL_STAGING_TOKEN está configurado
 * - Abierto: solo si no hay token ni Supabase (dev local)
 */
export async function resolvePortalAuth(req: Request): Promise<PortalAuthContext> {
  const requestedClientId = String(req.params.clientId || req.headers['x-portal-client-id'] || '').trim();
  const bearerToken = extractBearerToken(req.headers.authorization);

  if (bearerToken && isSupabaseAdminConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.getUser(bearerToken);
    if (!error && data.user) {
      const role = await resolveRoleFromSupabase(data.user.id);
      if (role && STAFF_ROLES.includes(role)) {
        if (!requestedClientId) {
          throw new UnauthorizedError('Missing clientId for portal preview', 'PORTAL_CLIENT_REQUIRED');
        }
        return {
          clientId: requestedClientId,
          tenantId: tenantIdFromRequest(req),
          mode: 'jwt-staff',
          userId: data.user.id,
          role,
        };
      }

      const bound = await resolveBoundClient(data.user.id, data.user);
      if (!bound) {
        throw new UnauthorizedError('Portal user not linked to a client', 'PORTAL_CLIENT_UNBOUND');
      }
      if (requestedClientId && requestedClientId !== bound.clientId) {
        throw new ForbiddenError('Cannot access another client account', 'PORTAL_FORBIDDEN');
      }
      const tenantId = await resolveClientPortalTenantId(bound);
      return { clientId: bound.clientId, tenantId, mode: 'jwt-client', userId: data.user.id };
    }
  }

  if (portalTokenConfigured()) {
    assertStagingToken(req);
    if (!requestedClientId) {
      throw new UnauthorizedError('Missing clientId', 'PORTAL_CLIENT_REQUIRED');
    }
    return { clientId: requestedClientId, tenantId: tenantIdFromRequest(req), mode: 'staging-token' };
  }

  if (!requestedClientId) {
    throw new UnauthorizedError('Missing clientId', 'PORTAL_CLIENT_REQUIRED');
  }
  if ((process.env.NODE_ENV || '').trim() === 'production') {
    throw new UnauthorizedError(
      'Portal requires Supabase JWT (client binding or staff role)',
      'PORTAL_AUTH_REQUIRED',
    );
  }
  return {
    clientId: requestedClientId,
    tenantId: tenantIdFromRequest(req) || DEFAULT_TENANT_ID,
    mode: 'open',
  };
}

export const portalAuthStatus = () => ({
  mode: portalTokenConfigured() ? 'staging-token' : (isSupabaseAdminConfigured ? 'jwt' : 'open'),
  authRequired: portalTokenConfigured() || isSupabaseAdminConfigured,
  jwtClientBinding: 'portal_user_bindings | user_metadata.client_id',
  note: portalTokenConfigured()
    ? 'Enviar x-portal-token o Bearer JWT staff/cliente'
    : isSupabaseAdminConfigured
      ? 'Bearer JWT Supabase (cliente vinculado o rol staff)'
      : 'Dev abierto — configurar Supabase o PORTAL_STAGING_TOKEN',
});
