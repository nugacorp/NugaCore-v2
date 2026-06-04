// ====================================================================
// Setup de entorno de pruebas (se ejecuta ANTES de cargar cualquier
// módulo del backend, por `setupFiles` de Vitest).
//
// CLAVE: backend/config/env.ts llama `dotenv.config()` SIN `override`, y
// dotenv NO sobrescribe variables que ya existen en process.env. Por eso
// lo que fijemos aquí GANA sobre el `.env` local del desarrollador.
//
// Tres modos, decididos por flags de opt-in que ponen los scripts
// `test:db` / `test:auth` (ver scripts/run-tests.mjs):
//
//   1. Hermético (default `npm test`): sin red, sin secretos, todo contra
//      el store en memoria. Estable y rápido aunque el .env apunte a una
//      Supabase real con USE_DB_CUSTOMERS=true.
//   2. DB real (RUN_DB_TESTS=true): no tocamos el entorno; el .env provee
//      las credenciales y el test golpea Supabase directamente.
//   3. Auth real (RUN_AUTH_TESTS=true): forzamos NODE_ENV=production para
//      replicar staging (JWT-only; los trusted-headers se ignoran), que es
//      justo lo que valida la suite de auth.
// ====================================================================

import dotenv from 'dotenv';

const runDb = process.env.RUN_DB_TESTS === 'true';
const runAuth = process.env.RUN_AUTH_TESTS === 'true';

// En modo DB/Auth real los tests leen sus credenciales (gates `hasSupabase`/
// `hasEnv`) en el top-level del archivo, ANTES de importar el backend. Cuando
// se corre un solo archivo (test:db/test:auth) nada dispara el dotenv de
// env.ts a tiempo, así que lo poblamos aquí. En modo hermético NO se carga:
// las credenciales reales ni se tocan.
if (runDb || runAuth) {
  dotenv.config();
}

// Feature flags por dominio (espejo de backend/config/feature-flags.ts).
const DOMAIN_FLAGS = [
  'USE_DB_CUSTOMERS',
  'USE_DB_PLANS',
  'USE_DB_BILLING',
  'USE_DB_SUSPENSION',
  'USE_DB_NETWORK',
  'USE_DB_FTTH',
  'USE_DB_INVENTORY',
  'USE_DB_SUPPORT',
  'USE_DB_MIKROTIK',
  'USE_DB_DASHBOARD',
  'USE_DB_GIS',
  'USE_DB_AUTOMATIONS',
  'USE_DB_REPORTS',
  'USE_DB_SECURITY',
];

// Credenciales/secretos que NO deben usarse en modo hermético.
// Se ponen a '' (cadena vacía) en vez de borrarse: así la clave SIGUE
// existiendo en process.env y dotenv.config() no la repuebla desde .env.
const REAL_SERVICE_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'STAGING_AUTH_PASSWORD',
];

if (!runDb && !runAuth) {
  // -------- MODO HERMÉTICO (default) --------
  for (const flag of DOMAIN_FLAGS) {
    process.env[flag] = 'false';
  }
  for (const secret of REAL_SERVICE_SECRETS) {
    process.env[secret] = '';
  }
  // Identidad por trusted-headers (dev): las lecturas de contrato sin
  // Bearer resuelven a 'solo lectura'. Forzado para no depender del .env.
  process.env.AUTH_TRUST_HEADERS = 'true';
  process.env.NODE_ENV = 'test';
} else if (runAuth) {
  // -------- MODO AUTH REAL (staging JWT-only) --------
  // La suite de auth verifica que en producción los trusted-headers se
  // ignoran; sin esto, un .env de desarrollo invalidaría esas aserciones.
  process.env.NODE_ENV = 'production';
}
// runDb: entorno intacto; el .env manda (Supabase real, repositorio directo).

export {};
