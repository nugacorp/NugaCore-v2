// ====================================================================
// Logger de cliente (Fase 1 production-ready).
//
// En desarrollo delega en console.*; en producción los niveles debug/
// info se silencian y warn/error quedan disponibles para diagnóstico.
// Punto único para enchufar telemetría (Sentry, etc.) más adelante
// sin tocar los componentes.
// ====================================================================

const isDev = import.meta.env.DEV;

export const clientLog = {
  debug: (...args: unknown[]): void => {
    if (isDev) console.debug(...args);
  },
  info: (...args: unknown[]): void => {
    if (isDev) console.info(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};
