import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../services/supabase-admin';
import { AppRole, normalizeRole } from './rbac';

export interface AuthContext {
  userId: string;
  role: AppRole;
  source: 'supabase-jwt' | 'trusted-headers';
}

const DEFAULT_ROLE: AppRole = 'solo lectura';

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
    const { data, error } = await supabaseAdmin.auth.getUser(bearerToken);
    if (!error && data.user) {
      const role = await resolveRoleFromSupabase(data.user.id);
      req.authContext = {
        userId: data.user.id,
        role,
        source: 'supabase-jwt',
      };
    }
  }

  if (!req.authContext && (env.AUTH_TRUST_HEADERS || !isSupabaseAdminConfigured)) {
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
