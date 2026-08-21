// ====================================================================
// Endpoint de configuración pública de runtime — `/runtime-config.js`.
//
// Permite que una misma imagen OCI se promueva entre ambientes: la URL y la
// anon key de Supabase dejan de incrustarse en el bundle en build-time y se
// entregan al arrancar el contenedor. Ver `src/config/runtimeConfig.ts`.
//
// REGLAS DE SEGURIDAD
//
//   1. Allowlist EXPLÍCITA. Nunca se recorre `process.env`: una variable nueva
//      no puede filtrarse por accidente al añadirla al despliegue.
//   2. Sólo valores diseñados para ser públicos. La service-role key, la
//      secret key, `DATABASE_URL`, las claves MikroTik y los secretos de
//      webhook no tienen ninguna ruta hasta aquí.
//   3. Serialización a prueba de ruptura de `<script>`. El payload se inyecta
//      dentro de un script clásico, así que `<`, `>`, `&`, U+2028 y U+2029 se
//      escapan como `\uXXXX`. Sin esto, un valor que contuviera `</script>`
//      cerraría la etiqueta y convertiría configuración en código.
//   4. `Cache-Control: no-store`. Promover el mismo digest a otro ambiente
//      debe cambiar la respuesta de inmediato; una copia cacheada apuntaría al
//      Supabase anterior.
//   5. Compatible con `script-src 'self'`: es un archivo servido por el propio
//      origen, no un inline.
// ====================================================================

import type { Request, RequestHandler, Response } from 'express';
import {
  RUNTIME_CONFIG_GLOBAL,
  RUNTIME_CONFIG_PATH,
  type PublicRuntimeConfig,
} from '../../src/config/runtimeConfig';

export { RUNTIME_CONFIG_GLOBAL, RUNTIME_CONFIG_PATH };

type EnvLike = Record<string, string | undefined>;

const firstNonEmpty = (env: EnvLike, keys: readonly string[]): string => {
  for (const key of keys) {
    const value = (env[key] || '').trim();
    if (value) return value;
  }
  return '';
};

/**
 * Precedencia deliberada: las variables del servidor mandan sobre las `VITE_*`.
 *
 * Un contenedor promovido recibe `SUPABASE_URL`/`SUPABASE_ANON_KEY` y debe
 * usarlas aunque la imagen conserve `VITE_*` de una build antigua. Las `VITE_*`
 * quedan como compatibilidad para desarrollo local.
 */
export const RUNTIME_CONFIG_URL_KEYS = ['SUPABASE_URL', 'VITE_SUPABASE_URL'] as const;

export const RUNTIME_CONFIG_ANON_KEY_KEYS = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
] as const;

/** Construye el payload público. Allowlist estricta, sin recorrer el entorno. */
export function resolvePublicRuntimeConfig(env: EnvLike = process.env): PublicRuntimeConfig {
  return {
    SUPABASE_URL: firstNonEmpty(env, RUNTIME_CONFIG_URL_KEYS),
    SUPABASE_ANON_KEY: firstNonEmpty(env, RUNTIME_CONFIG_ANON_KEY_KEYS),
  };
}

/**
 * JSON seguro para incrustar dentro de `<script>`.
 *
 * `<` es un escape válido en un literal de JavaScript y se evalúa como
 * `<`, así que el valor llega intacto al cliente sin poder cerrar la etiqueta.
 * U+2028 y U+2029 son saltos de línea válidos en JSON pero ILEGALES dentro de
 * un literal de JS: sin escaparlos, el script no parsea.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Cuerpo del script servido en `/runtime-config.js`. */
export function buildRuntimeConfigScript(config: PublicRuntimeConfig): string {
  return `window.${RUNTIME_CONFIG_GLOBAL}=${serializeForScript(config)};\n`;
}

/**
 * Handler Express. Se registra ANTES del middleware estático y del fallback
 * SPA, y antes de auth/onboarding: el bootstrap del cliente no puede depender
 * de estar autenticado ni de haber completado el wizard.
 */
export const runtimeConfigHandler: RequestHandler = (_req: Request, res: Response) => {
  const config = resolvePublicRuntimeConfig(process.env);
  res
    .status(200)
    .setHeader('Cache-Control', 'no-store')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .type('application/javascript; charset=utf-8')
    .send(buildRuntimeConfigScript(config));
};
