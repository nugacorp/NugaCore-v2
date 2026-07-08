import { Request } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../common/errors';
import { AppRole, normalizeRole } from '../../common/rbac';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';

export type PortalAuthMode = 'jwt-client' | 'jwt-staff' | 'staging-token' | 'open';

export interface PortalAuthContext {
  clientId: string;
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

const resolveBoundClientId = async (userId: string, user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }): Promise<string | null> => {
  const fromMeta = readMetadataClientId(user);
  if (fromMeta) return fromMeta;

  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from('portal_user_bindings')
    .select('client_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error || !data?.client_id) return null;
  return String(data.client_id);
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
 * - JWT cliente: clientId del token debe coincidir con :clientId
 * - JWT staff: puede ver cualquier cliente (preview interno)
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
        return { clientId: requestedClientId, mode: 'jwt-staff', userId: data.user.id, role };
      }

      const boundClientId = await resolveBoundClientId(data.user.id, data.user);
      if (!boundClientId) {
        throw new UnauthorizedError('Portal user not linked to a client', 'PORTAL_CLIENT_UNBOUND');
      }
      if (requestedClientId && requestedClientId !== boundClientId) {
        throw new ForbiddenError('Cannot access another client account', 'PORTAL_FORBIDDEN');
      }
      return { clientId: boundClientId, mode: 'jwt-client', userId: data.user.id };
    }
  }

  if (portalTokenConfigured()) {
    assertStagingToken(req);
    if (!requestedClientId) {
      throw new UnauthorizedError('Missing clientId', 'PORTAL_CLIENT_REQUIRED');
    }
    return { clientId: requestedClientId, mode: 'staging-token' };
  }

  if (!requestedClientId) {
    throw new UnauthorizedError('Missing clientId', 'PORTAL_CLIENT_REQUIRED');
  }
  return { clientId: requestedClientId, mode: 'open' };
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
