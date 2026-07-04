// ====================================================================
// Utilidades de errores del frontend (Fase 5 production-ready).
// Extrae un mensaje legible de un error `unknown` (catch estricto)
// sin recurrir a `any`.
// ====================================================================

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}
