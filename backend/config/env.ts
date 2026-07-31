import dotenv from 'dotenv';
import { logger } from '../common/logger';

dotenv.config();

const asNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: asNumber(process.env.PORT, 3000),
  APP_URL: process.env.APP_URL || 'http://localhost:3000',
  AUTH_TRUST_HEADERS: (process.env.AUTH_TRUST_HEADERS || 'false').toLowerCase() === 'true',
  LOG_LEVEL: process.env.LOG_LEVEL || '',
  LOG_FORMAT: process.env.LOG_FORMAT || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY:
    process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || '',
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY
    || '',
  SUPABASE_JWKS_URL: process.env.SUPABASE_JWKS_URL || '',
  DATABASE_URL: process.env.DATABASE_URL || '',
  MIKROTIK_CREDENTIALS_KEY: process.env.MIKROTIK_CREDENTIALS_KEY || '',
  // Marca de "despliegue accesible desde internet" (staging/prod). Permite
  // endurecer la coraza sin depender de que NODE_ENV sea EXACTAMENTE
  // 'production' (ver C-03 en el reporte de auditoria). Default: false.
  PUBLIC_DEPLOYMENT: (process.env.PUBLIC_DEPLOYMENT || 'false').toLowerCase() === 'true',
} as const;

export const isProduction = env.NODE_ENV === 'production';

// Runtime "endurecido": produccion real O cualquier despliegue marcado como
// publico. La coraza de borde (JWT-only, HSTS, CSP, trust proxy, fail-fast,
// secretos de webhook obligatorios) se activa cuando esto es true, para que un
// servidor en internet con NODE_ENV distinto de 'production' NO quede abierto.
export const isPublicDeployment = env.PUBLIC_DEPLOYMENT;
export const isHardenedRuntime = isProduction || isPublicDeployment;

/**
 * Misma decisión que `isHardenedRuntime`, pero leyendo process.env EN CADA
 * LLAMADA. `isHardenedRuntime` se congela al importar el módulo; los gates de
 * seguridad que deben poder auditarse (y probarse) por request usan esta
 * versión para que un cambio de entorno nunca deje un fallback encendido.
 */
export const isHardenedRuntimeNow = (): boolean =>
  (process.env.NODE_ENV || '').trim() === 'production'
  || (process.env.PUBLIC_DEPLOYMENT || '').trim().toLowerCase() === 'true';

// ====================================================================
// Validación de entorno.
//
// Fase 4.9.2.5 (Production Readiness): en producción hace FAIL-FAST ante
// configuración crítica de seguridad — el proceso NO debe arrancar con un
// agujero conocido. Fuera de producción solo advierte.
//
// Crítico en producción (lanza):
//   - AUTH_TRUST_HEADERS=true  -> permitiría declarar el rol desde el cliente.
//   - MIKROTIK_CREDENTIALS_KEY ausente -> secretos sin cifrado robusto.
//   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes -> no hay auth verificable.
// ====================================================================
export function validateEnvironment(): void {
  // Fail-fast en cualquier runtime endurecido (produccion o PUBLIC_DEPLOYMENT),
  // no solo cuando NODE_ENV es EXACTAMENTE 'production'. Ver C-03.
  if (!isHardenedRuntime) return;

  const fatal: string[] = [];

  if (env.AUTH_TRUST_HEADERS) {
    fatal.push(
      'AUTH_TRUST_HEADERS=true en producción: los clientes podrían declarar su propio rol. ' +
        'Ponlo en "false" (identidad por JWT Supabase verificado). Ver SECURITY_AUDIT.md S-01.',
    );
  }

  if (!env.MIKROTIK_CREDENTIALS_KEY) {
    fatal.push(
      'MIKROTIK_CREDENTIALS_KEY ausente en producción: el cifrado de credenciales/secretos ' +
        '(WireGuard, MikroTik) no estaría protegido de forma robusta. Ver backend/services/crypto.ts.',
    );
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    fatal.push(
      'Supabase no configurado en producción (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY): ' +
        'sin esto no hay autenticación ni RBAC verificables desde DB.',
    );
  }

  if (fatal.length > 0) {
    const detail = fatal.map((m, i) => `  ${i + 1}. ${m}`).join('\n');
    logger.error(`Configuración de producción inválida (fail-fast):\n${detail}`);
    throw new Error(`Configuración de producción inválida:\n${detail}`);
  }
}
