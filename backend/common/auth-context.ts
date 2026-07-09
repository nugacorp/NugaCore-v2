import { NextFunction, Request, Response } from 'express';
import { env, isHardenedRuntime } from '../config/env';
import { logger } from './logger';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../services/supabase-admin';
import { AppRole, normalizeRole } from './rbac';

export interface AuthContext {
  userId: string;
  role: AppRole;
  source: 'supabase-jwt' | 'trusted-headers';
}

const DEFAULT_ROLE: AppRole = 'solo lectura';

// ====================================================================
// Trusted headers (the client asserting its own x-user-role) are a
// DEV-ONLY convenience. In PRODUCTION they are ALWAYS disabled: identity
// must come from a verified Supabase JWT. This removes any dependency on
// AUTH_TRUST_HEADERS for production hardening (Fase 2).
// ====================================================================
export const computeAllowTrustedHeaders = (
  productionMode: boolean,
  trustHeadersEnv: boolean,
  supabaseConfigured: boolean,
): boolean => {
  if (productionMode) return false; // prod: JWT-only, no exceptions
  return trustHeadersEnv || !supabaseConfigured; // dev: explicit flag, or no Supabase yet
};

// En cualquier runtime endurecido (produccion o PUBLIC_DEPLOYMENT) los
// trusted-headers quedan SIEMPRE deshabilitados: identidad solo por JWT.
const allowTrustedHeaders = computeAllowTrustedHeaders(
  isHardenedRuntime,
  env.AUTH_TRUST_HEADERS,
  isSupabaseAdminConfigured,
);

if (isHardenedRuntime && !isSupabaseAdminConfigured) {
  logger.warn(
    'Producción sin Supabase configurado: no hay forma de autenticar. ' +
      'Todas las rutas protegidas responderán 401. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.',
  );
}
if (!isHardenedRuntime && allowTrustedHeaders) {
  logger.info('Auth: trusted-headers habilitados (solo dev). En producción se ignoran; identidad por JWT.');
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

  // Trusted-header fallback: ONLY in non-production (see computeAllowTrustedHeaders).
  // In production this branch never runs, so a spoofed x-user-role is ignored.
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
