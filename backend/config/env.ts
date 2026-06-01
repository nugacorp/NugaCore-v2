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
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  DATABASE_URL: process.env.DATABASE_URL || '',
  MIKROTIK_CREDENTIALS_KEY: process.env.MIKROTIK_CREDENTIALS_KEY || '',
} as const;

export const isProduction = env.NODE_ENV === 'production';

// ====================================================================
// Validación de entorno (fail-fast suave).
// En Fase 0 solo ADVIERTE (no lanza): Supabase aún no se conecta.
// Marca configuraciones peligrosas para producción.
// ====================================================================
export function validateEnvironment(): void {
  if (!isProduction) return;

  if (env.AUTH_TRUST_HEADERS) {
    logger.warn(
      'AUTH_TRUST_HEADERS está activo en producción: los clientes pueden declarar su propio rol. ' +
        'Ponlo en "false" y usa autenticación verificada (ver SECURITY_AUDIT.md S-01).',
    );
  }

  if (!env.MIKROTIK_CREDENTIALS_KEY) {
    logger.warn(
      'MIKROTIK_CREDENTIALS_KEY no está definida. El cifrado de credenciales MikroTik ' +
        'fallará al usarse en producción (ver backend/services/crypto.ts).',
    );
  }

  // Aviso informativo: la persistencia real llega en Fase 1.
  if (!env.SUPABASE_URL) {
    logger.info('Supabase no configurado: NugaCore opera con el store en memoria (Fase 0).');
  }
}
