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

export type SignupEmailSendResult = {
  sent: boolean;
  error?: string;
  /** Código estable para la UI (p. ej. EMAIL_RATE_LIMITED). */
  errorCode?: 'EMAIL_RATE_LIMITED' | 'EMAIL_SEND_FAILED' | 'ANON_KEY_MISSING';
};

export function classifySignupEmailError(message: string): SignupEmailSendResult['errorCode'] {
  const lower = message.toLowerCase();
  if (
    lower.includes('rate limit')
    || lower.includes('too many requests')
    || lower.includes('over_email_send_rate_limit')
    || lower.includes('email rate limit exceeded')
  ) {
    return 'EMAIL_RATE_LIMITED';
  }
  return 'EMAIL_SEND_FAILED';
}

/**
 * Dispara el correo de confirmación de Supabase Auth (plantilla Signup).
 * createUser(admin) no envía correo; hace falta resend con la anon/publishable key.
 */
export async function sendSignupConfirmationEmail(
  email: string,
  emailRedirectTo: string,
): Promise<SignupEmailSendResult> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    logger.warn('Confirmación de email: falta SUPABASE_ANON_KEY; no se pudo enviar correo');
    return { sent: false, error: 'SUPABASE_ANON_KEY missing', errorCode: 'ANON_KEY_MISSING' };
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
    const errorCode = classifySignupEmailError(error.message);
    logger.warn('Confirmación de email: resend falló', {
      email,
      message: error.message,
      errorCode,
    });
    return { sent: false, error: error.message, errorCode };
  }

  logger.info('Confirmación de email: correo de signup enviado', { email });
  return { sent: true };
}
