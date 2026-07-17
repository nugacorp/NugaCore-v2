/** Mensajes claros para errores de correo Auth (resend / signup). */
export function messageForAuthEmailError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const lower = raw.toLowerCase();
  if (
    lower.includes('rate limit')
    || lower.includes('too many requests')
    || lower.includes('429')
    || lower.includes('email rate limit exceeded')
  ) {
    return 'Límite de correos de Supabase alcanzado. Espera unos minutos (a veces hasta 1 h) y vuelve a intentar. Si ya registraste la cuenta, prueba iniciar sesión.';
  }
  if (lower.includes('already') && (lower.includes('confirm') || lower.includes('registered'))) {
    return 'Esta cuenta ya está confirmada o registrada. Intenta iniciar sesión.';
  }
  return raw.trim() || fallback;
}
