// ====================================================================
// Configuración PÚBLICA de runtime (build-once / deploy-many).
//
// EL PROBLEMA QUE RESUELVE
//
// Vite incrusta `VITE_*` en el bundle en tiempo de build. Si la URL y la
// anon key de Supabase entran por build args, la imagen queda atada al
// ambiente para el que se construyó: el digest validado en staging NO puede
// promoverse intacto a producción, porque su JavaScript apunta al Supabase
// equivocado. Se acabaría reconstruyendo por ambiente, y entonces lo que se
// despliega en producción no es lo que se probó.
//
// La solución es servir esos dos valores en runtime desde el propio servidor,
// en `/runtime-config.js`, y dejar que el mismo digest se promueva entre
// ambientes cambiando sólo variables del contenedor.
//
// QUÉ PUEDE VIAJAR AQUÍ
//
// SÓLO configuración pública: la URL de Supabase y la anon/publishable key,
// que el navegador ya recibe hoy dentro del bundle y que están diseñadas para
// ser públicas (la seguridad real la da RLS, no su secreto).
//
// NUNCA la service-role key, la secret key, `DATABASE_URL`, claves de
// MikroTik ni secretos de webhooks. El servidor construye el payload con una
// allowlist explícita, jamás recorriendo `process.env`.
// ====================================================================

/** Nombre del global donde el servidor deja la configuración pública. */
export const RUNTIME_CONFIG_GLOBAL = '__NUGACORE_RUNTIME_CONFIG__';

/** Ruta que sirve el script. Debe resolverse antes del estático y del SPA. */
export const RUNTIME_CONFIG_PATH = '/runtime-config.js';

/** Único contrato público. Añadir campos aquí exige revisarlo como superficie pública. */
export interface PublicRuntimeConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

type RuntimeConfigHost = Record<string, unknown>;

/**
 * Lee la configuración inyectada por el servidor. Devuelve `null` cuando no
 * hay ninguna (desarrollo sin servidor, pruebas, o servidor sin configurar),
 * para que el llamador decida su propio fallback.
 */
export function readRuntimeConfig(
  host: RuntimeConfigHost = globalThis as unknown as RuntimeConfigHost,
): PublicRuntimeConfig | null {
  const raw = host[RUNTIME_CONFIG_GLOBAL];
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Partial<PublicRuntimeConfig>;
  const url = typeof candidate.SUPABASE_URL === 'string' ? candidate.SUPABASE_URL.trim() : '';
  const anonKey = typeof candidate.SUPABASE_ANON_KEY === 'string'
    ? candidate.SUPABASE_ANON_KEY.trim()
    : '';

  if (!url && !anonKey) return null;
  return { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey };
}

/**
 * Origen efectivo de la configuración del cliente.
 *
 *   'runtime'   el servidor entregó el par completo
 *   'build'     no hay runtime en absoluto y las VITE_* traen el par completo
 *   'none'      no hay configuración utilizable
 */
export type RuntimeConfigSource = 'runtime' | 'build' | 'none';

export interface ResolvedClientConfig {
  source: RuntimeConfigSource;
  url: string;
  anonKey: string;
  /** Motivo cuando `source` es 'none'; sirve para diagnóstico, no para UI. */
  reason?: 'no-config' | 'incomplete-runtime' | 'incomplete-build';
}

const bothPresent = (url: string, key: string): boolean =>
  url.trim() !== '' && key.trim() !== '';

/**
 * Elige la fuente como UNA UNIDAD, nunca campo por campo.
 *
 * Seleccionar cada campo por separado permitía mezclar ambientes: una URL de
 * producción servida en runtime junto a una anon key de staging incrustada en
 * el bundle. Eso no es sólo incorrecto, es peligroso — el cliente hablaría con
 * un proyecto usando la credencial de otro.
 *
 * Por eso, si el runtime está PRESENTE pero incompleto, no se recurre a las
 * VITE_*: se falla cerrado. Las VITE_* sólo entran cuando no hay runtime en
 * absoluto, que es el caso del desarrollo local.
 */
export function resolveClientSupabaseConfig(input: {
  runtime: PublicRuntimeConfig | null;
  buildUrl?: string;
  buildAnonKey?: string;
}): ResolvedClientConfig {
  const { runtime } = input;
  const buildUrl = (input.buildUrl || '').trim();
  const buildAnonKey = (input.buildAnonKey || '').trim();

  if (runtime) {
    if (bothPresent(runtime.SUPABASE_URL, runtime.SUPABASE_ANON_KEY)) {
      return {
        source: 'runtime',
        url: runtime.SUPABASE_URL.trim(),
        anonKey: runtime.SUPABASE_ANON_KEY.trim(),
      };
    }
    // Runtime presente pero a medias: fail-closed sin tocar las VITE_*.
    return { source: 'none', url: '', anonKey: '', reason: 'incomplete-runtime' };
  }

  if (bothPresent(buildUrl, buildAnonKey)) {
    return { source: 'build', url: buildUrl, anonKey: buildAnonKey };
  }

  return {
    source: 'none',
    url: '',
    anonKey: '',
    reason: buildUrl || buildAnonKey ? 'incomplete-build' : 'no-config',
  };
}
