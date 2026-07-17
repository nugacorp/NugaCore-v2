import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env';
import { logger } from '../../common/logger';

const appBaseUrl = (): string =>
  (process.env.APP_URL || env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Destinos Auth permitidos (mismo origen que APP_URL). */
export const resolveAuthRedirectUrl = (
  requested: string | undefined,
  path: '/auth/callback' | '/reset-password',
): string => {
  const base = appBaseUrl();
  const fallback = `${base}${path}`;
  if (!requested) return fallback;
  try {
    const url = new URL(requested);
    const allowed = new URL(base);
    if (url.origin !== allowed.origin) return fallback;
    if (!url.pathname.startsWith('/')) return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
};

/**
 * Dispara el correo de confirmación de Supabase Auth (plantilla Signup).
 * createUser(admin) no envía correo; hace falta resend con la anon key.
 */
export async function sendSignupConfirmationEmail(
  email: string,
  emailRedirectTo: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    logger.warn('Confirmación de email: falta SUPABASE_ANON_KEY; no se pudo enviar correo');
    return { sent: false, error: 'SUPABASE_ANON_KEY missing' };
  }

  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await anon.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo },
  });

  if (error) {
    logger.warn('Confirmación de email: resend falló', { email, message: error.message });
    return { sent: false, error: error.message };
  }

  logger.info('Confirmación de email: correo de signup enviado', { email });
  return { sent: true };
}
