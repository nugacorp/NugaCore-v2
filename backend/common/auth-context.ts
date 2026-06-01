import { NextFunction, Request, Response } from 'express';
import { env, isProduction } from '../config/env';
import { logger } from './logger';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../services/supabase-admin';
import { AppRole, normalizeRole } from './rbac';

export interface AuthContext {
  userId: string;
  role: AppRole;
  source: 'supabase-jwt' | 'trusted-headers';
}

const DEFAULT_ROLE: AppRole = 'solo lectura';

// Trusted headers let any client assert its own role, so they must never be the
// only line of defense in production. Auto-enabling them just because Supabase is
// missing would leave a production deploy fully open.
const allowTrustedHeaders = env.AUTH_TRUST_HEADERS || (!isSupabaseAdminConfigured && !isProduction);

if (isProduction && allowTrustedHeaders) {
  logger.warn(
    'Trusted-header auth is enabled in production: clients can assert their own role. ' +
      'Configure Supabase and unset AUTH_TRUST_HEADERS to disable.',
  );
}

const extractBearerToken = (value: string | undefined): string | null => {
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token;
};

const resolveRoleFromSupabase = async (userId: string): Promise<AppRole> => {
  if (!supabaseAdmin) return DEFAULT_ROLE;

  const { data: mappedRole } = await supabaseAdmin
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  const roleName = ((mappedRole as any)?.roles?.name || '').trim();
  const normalized = normalizeRole(roleName);
  return normalized || DEFAULT_ROLE;
};

export const attachAuthContext = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const bearerToken = extractBearerToken(req.headers.authorization);

  if (bearerToken && isSupabaseAdminConfigured && supabaseAdmin) {
    // Express 4 does not catch rejected promises from async middleware, so an
    // unhandled throw here (Supabase outage, network error) would hang the
    // request forever. Degrade gracefully instead: leave authContext unset and
    // let downstream guards return 401.
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(bearerToken);
      if (!error && data.user) {
        const role = await resolveRoleFromSupabase(data.user.id);
        req.authContext = {
          userId: data.user.id,
          role,
          source: 'supabase-jwt',
        };
      }
    } catch (err) {
      logger.error('Supabase auth validation failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!req.authContext && allowTrustedHeaders) {
    const role = normalizeRole(req.headers['x-user-role']) || DEFAULT_ROLE;
    const headerUserId = Array.isArray(req.headers['x-user-id'])
      ? req.headers['x-user-id'][0]
      : req.headers['x-user-id'];

    req.authContext = {
      userId: (headerUserId || 'header-user').toString(),
      role,
      source: 'trusted-headers',
    };
  }

  next();
};
