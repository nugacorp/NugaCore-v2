import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../backend/app';
import {
  RUNTIME_CONFIG_GLOBAL,
  RUNTIME_CONFIG_PATH,
  buildRuntimeConfigScript,
  resolvePublicRuntimeConfig,
  serializeForScript,
} from '../../backend/common/runtime-config';
import { readRuntimeConfig, resolveClientSupabaseConfig } from '../../src/config/runtimeConfig';

// ====================================================================
// build-once / deploy-many.
//
// Vite incrusta `VITE_*` en el bundle en build-time, así que una imagen
// construida para staging no podía promoverse intacta a producción. El
// servidor entrega ahora la configuración PÚBLICA en runtime.
//
// Aquí se fija el contrato completo: precedencia, cabeceras, escape seguro y
// —sobre todo— que ningún secreto del servidor pueda salir por esta ruta.
//
// Hermético: no se contacta con Supabase ni con ningún servicio externo.
// ====================================================================

const SECRET_MARKER = 'MARCADOR-SECRETO-QUE-NUNCA-DEBE-SALIR';

let app: Express;
beforeAll(() => { app = createApp(); });

afterEach(() => {
  vi.unstubAllEnvs();
});

const fetchConfig = () => request(app).get(RUNTIME_CONFIG_PATH);

describe('resolución de la configuración pública', () => {
  it('toma las variables del servidor', () => {
    const config = resolvePublicRuntimeConfig({
      SUPABASE_URL: 'https://server.supabase.test',
      SUPABASE_ANON_KEY: 'anon-server',
    });

    expect(config).toEqual({
      SUPABASE_URL: 'https://server.supabase.test',
      SUPABASE_ANON_KEY: 'anon-server',
    });
  });

  it('las variables del servidor tienen precedencia sobre las VITE_*', () => {
    const config = resolvePublicRuntimeConfig({
      SUPABASE_URL: 'https://server.supabase.test',
      VITE_SUPABASE_URL: 'https://build-time.supabase.test',
      SUPABASE_ANON_KEY: 'anon-server',
      VITE_SUPABASE_ANON_KEY: 'anon-build-time',
    });

    expect(config.SUPABASE_URL).toBe('https://server.supabase.test');
    expect(config.SUPABASE_ANON_KEY).toBe('anon-server');
  });

  it('cae a las VITE_* cuando no hay variables de servidor (compatibilidad dev)', () => {
    const config = resolvePublicRuntimeConfig({
      VITE_SUPABASE_URL: 'https://build-time.supabase.test',
      VITE_SUPABASE_ANON_KEY: 'anon-build-time',
    });

    expect(config.SUPABASE_URL).toBe('https://build-time.supabase.test');
    expect(config.SUPABASE_ANON_KEY).toBe('anon-build-time');
  });

  it('acepta la publishable key como alternativa de la anon key', () => {
    expect(resolvePublicRuntimeConfig({ SUPABASE_PUBLISHABLE_KEY: 'pub-server' }).SUPABASE_ANON_KEY)
      .toBe('pub-server');
    expect(resolvePublicRuntimeConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'pub-vite' }).SUPABASE_ANON_KEY)
      .toBe('pub-vite');
  });

  it('sin configuración devuelve cadenas vacías, no undefined', () => {
    expect(resolvePublicRuntimeConfig({})).toEqual({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' });
  });

  it('ignora valores en blanco y sigue con el siguiente candidato', () => {
    const config = resolvePublicRuntimeConfig({
      SUPABASE_URL: '   ',
      VITE_SUPABASE_URL: 'https://build-time.supabase.test',
    });

    expect(config.SUPABASE_URL).toBe('https://build-time.supabase.test');
  });

  it('NUNCA expone secretos del servidor, aunque estén en el entorno', () => {
    const config = resolvePublicRuntimeConfig({
      SUPABASE_URL: 'https://server.supabase.test',
      SUPABASE_ANON_KEY: 'anon-server',
      SUPABASE_SERVICE_ROLE_KEY: SECRET_MARKER,
      SUPABASE_SECRET_KEY: SECRET_MARKER,
      DATABASE_URL: SECRET_MARKER,
      MIKROTIK_CREDENTIALS_KEY: SECRET_MARKER,
      WEBHOOK_SECRET_MANUAL: SECRET_MARKER,
      WEBHOOK_SECRET_OPENPAY: SECRET_MARKER,
      MIKROTIK_PASS: SECRET_MARKER,
      STAGING_AUTH_PASSWORD: SECRET_MARKER,
    });

    expect(Object.keys(config).sort()).toEqual(['SUPABASE_ANON_KEY', 'SUPABASE_URL']);
    expect(JSON.stringify(config)).not.toContain(SECRET_MARKER);
  });
});

describe('serialización segura para <script>', () => {
  it('escapa el cierre de etiqueta para que no pueda romper el script', () => {
    const payload = serializeForScript({ SUPABASE_URL: '</script><script>alert(1)</script>' });

    expect(payload).not.toContain('</script>');
    expect(payload).not.toContain('<');
    expect(payload).toContain('\\u003c');
  });

  it('escapa U+2028 y U+2029, que son ilegales en un literal de JavaScript', () => {
    const payload = serializeForScript({ SUPABASE_ANON_KEY: 'a b c' });

    expect(payload).not.toContain(' ');
    expect(payload).not.toContain(' ');
    expect(payload).toContain('\\u2028');
    expect(payload).toContain('\\u2029');
  });

  it('escapa el ampersand', () => {
    expect(serializeForScript({ k: 'a&b' })).toContain('\\u0026');
  });

  it('el script producido es JavaScript evaluable y conserva los valores', () => {
    const original = { SUPABASE_URL: 'https://x.test/</script>', SUPABASE_ANON_KEY: 'k k' };
    const script = buildRuntimeConfigScript(original);
    const host: Record<string, unknown> = {};

    // Evaluación local del script generado; sin red ni DOM.
    new Function('window', script)(host);

    expect(host[RUNTIME_CONFIG_GLOBAL]).toEqual(original);
  });

  it('asigna sobre el global acordado por el contrato', () => {
    expect(buildRuntimeConfigScript({ SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }))
      .toContain(`window.${RUNTIME_CONFIG_GLOBAL}=`);
  });
});

describe('GET /runtime-config.js', () => {
  it('responde 200 con JavaScript y sin cache', async () => {
    const res = await fetchConfig();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('entrega los valores públicos inyectados en el contenedor', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://runtime.supabase.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-runtime');

    const res = await fetchConfig();

    expect(res.text).toContain('https://runtime.supabase.test');
    expect(res.text).toContain('anon-runtime');
  });

  it('no filtra ningún secreto del servidor', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://runtime.supabase.test');
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon-runtime');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SECRET_MARKER);
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET_MARKER);
    vi.stubEnv('DATABASE_URL', SECRET_MARKER);
    vi.stubEnv('MIKROTIK_CREDENTIALS_KEY', SECRET_MARKER);
    vi.stubEnv('WEBHOOK_SECRET_MANUAL', SECRET_MARKER);

    const res = await fetchConfig();

    expect(res.text).not.toContain(SECRET_MARKER);
    // Y sólo declara las dos claves del contrato.
    expect(res.text.match(/SUPABASE_[A-Z_]+/g)?.sort()).toEqual(['SUPABASE_ANON_KEY', 'SUPABASE_URL']);
  });

  it('sin configuración responde un script válido con valores vacíos', async () => {
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');

    const res = await fetchConfig();
    const host: Record<string, unknown> = {};
    new Function('window', res.text)(host);

    expect(res.status).toBe(200);
    // Fail-closed: el cliente no encuentra configuración y no crea cliente.
    expect(readRuntimeConfig(host)).toBeNull();
  });

  it('no exige sesión ni onboarding completado', async () => {
    // Sin cabeceras de identidad: el bootstrap del SPA debe poder cargarlo.
    const res = await request(app).get(RUNTIME_CONFIG_PATH);
    expect(res.status).toBe(200);
  });
});

describe('lector del cliente', () => {
  it('devuelve null cuando no hay global', () => {
    expect(readRuntimeConfig({})).toBeNull();
  });

  it('devuelve null cuando ambos valores están vacíos', () => {
    expect(readRuntimeConfig({ [RUNTIME_CONFIG_GLOBAL]: { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' } }))
      .toBeNull();
  });

  it('lee la configuración inyectada', () => {
    const host = {
      [RUNTIME_CONFIG_GLOBAL]: {
        SUPABASE_URL: ' https://x.test ',
        SUPABASE_ANON_KEY: ' anon ',
      },
    };

    expect(readRuntimeConfig(host)).toEqual({
      SUPABASE_URL: 'https://x.test',
      SUPABASE_ANON_KEY: 'anon',
    });
  });

  it('ignora un global con forma inesperada', () => {
    expect(readRuntimeConfig({ [RUNTIME_CONFIG_GLOBAL]: 'no-es-objeto' })).toBeNull();
    expect(readRuntimeConfig({ [RUNTIME_CONFIG_GLOBAL]: { SUPABASE_URL: 42 } })).toBeNull();
  });
});

describe('la fuente de configuración se elige como UNA UNIDAD', () => {
  // Elegir campo por campo permitía mezclar ambientes: URL de producción
  // servida en runtime + anon key de staging incrustada en el bundle. El
  // cliente hablaría con un proyecto usando la credencial de otro.
  const RUNTIME_URL = 'https://runtime.supabase.test';
  const RUNTIME_KEY = 'anon-runtime';
  const BUILD_URL = 'https://build.supabase.test';
  const BUILD_KEY = 'anon-build';

  it('par runtime completo → usa runtime', () => {
    const result = resolveClientSupabaseConfig({
      runtime: { SUPABASE_URL: RUNTIME_URL, SUPABASE_ANON_KEY: RUNTIME_KEY },
      buildUrl: BUILD_URL,
      buildAnonKey: BUILD_KEY,
    });

    expect(result.source).toBe('runtime');
    expect(result.url).toBe(RUNTIME_URL);
    expect(result.anonKey).toBe(RUNTIME_KEY);
  });

  it('runtime completamente ausente + par Vite completo → usa build', () => {
    const result = resolveClientSupabaseConfig({
      runtime: null,
      buildUrl: BUILD_URL,
      buildAnonKey: BUILD_KEY,
    });

    expect(result.source).toBe('build');
    expect(result.url).toBe(BUILD_URL);
    expect(result.anonKey).toBe(BUILD_KEY);
  });

  it('URL runtime sin key + key Vite → FAIL-CLOSED, no mezcla', () => {
    const result = resolveClientSupabaseConfig({
      runtime: { SUPABASE_URL: RUNTIME_URL, SUPABASE_ANON_KEY: '' },
      buildUrl: BUILD_URL,
      buildAnonKey: BUILD_KEY,
    });

    expect(result.source).toBe('none');
    expect(result.reason).toBe('incomplete-runtime');
    expect(result.url).toBe('');
    expect(result.anonKey).toBe('');
    // Y en particular NO tomó la key del bundle.
    expect(result.anonKey).not.toBe(BUILD_KEY);
  });

  it('key runtime sin URL + URL Vite → FAIL-CLOSED, no mezcla', () => {
    const result = resolveClientSupabaseConfig({
      runtime: { SUPABASE_URL: '', SUPABASE_ANON_KEY: RUNTIME_KEY },
      buildUrl: BUILD_URL,
      buildAnonKey: BUILD_KEY,
    });

    expect(result.source).toBe('none');
    expect(result.reason).toBe('incomplete-runtime');
    expect(result.url).not.toBe(BUILD_URL);
  });

  it('runtime parcial SIN Vite → fail-closed', () => {
    const result = resolveClientSupabaseConfig({
      runtime: { SUPABASE_URL: RUNTIME_URL, SUPABASE_ANON_KEY: '' },
    });

    expect(result.source).toBe('none');
    expect(result.reason).toBe('incomplete-runtime');
  });

  it('ninguna configuración → fail-closed', () => {
    const result = resolveClientSupabaseConfig({ runtime: null });

    expect(result.source).toBe('none');
    expect(result.reason).toBe('no-config');
    expect(result.url).toBe('');
    expect(result.anonKey).toBe('');
  });

  it('Vite incompleto sin runtime → fail-closed, tampoco a medias', () => {
    expect(resolveClientSupabaseConfig({ runtime: null, buildUrl: BUILD_URL }))
      .toMatchObject({ source: 'none', reason: 'incomplete-build' });
    expect(resolveClientSupabaseConfig({ runtime: null, buildAnonKey: BUILD_KEY }))
      .toMatchObject({ source: 'none', reason: 'incomplete-build' });
  });

  it('trata el whitespace como ausencia', () => {
    const result = resolveClientSupabaseConfig({
      runtime: { SUPABASE_URL: RUNTIME_URL, SUPABASE_ANON_KEY: '   ' },
      buildUrl: BUILD_URL,
      buildAnonKey: BUILD_KEY,
    });

    expect(result.source).toBe('none');
  });

  it('nunca devuelve un par de fuentes distintas', () => {
    const cases = [
      { runtime: { SUPABASE_URL: RUNTIME_URL, SUPABASE_ANON_KEY: RUNTIME_KEY }, buildUrl: BUILD_URL, buildAnonKey: BUILD_KEY },
      { runtime: { SUPABASE_URL: RUNTIME_URL, SUPABASE_ANON_KEY: '' }, buildUrl: BUILD_URL, buildAnonKey: BUILD_KEY },
      { runtime: { SUPABASE_URL: '', SUPABASE_ANON_KEY: RUNTIME_KEY }, buildUrl: BUILD_URL, buildAnonKey: BUILD_KEY },
      { runtime: null, buildUrl: BUILD_URL, buildAnonKey: BUILD_KEY },
    ];

    for (const input of cases) {
      const { url, anonKey } = resolveClientSupabaseConfig(input);
      const mixed =
        (url === RUNTIME_URL && anonKey === BUILD_KEY)
        || (url === BUILD_URL && anonKey === RUNTIME_KEY);
      expect(mixed, `mezcló fuentes: url=${url} key=${anonKey}`).toBe(false);
    }
  });
});

describe('bootstrap del documento', () => {
  const html = readFileSync('index.html', 'utf8');

  it('carga /runtime-config.js antes del módulo principal', () => {
    const configAt = html.indexOf('/runtime-config.js');
    const mainAt = html.indexOf('/src/main.tsx');

    expect(configAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(-1);
    expect(configAt).toBeLessThan(mainAt);
  });

  it('lo carga como script clásico, no como módulo diferido', () => {
    expect(html).toMatch(/<script src="\/runtime-config\.js"><\/script>/);
  });
});

describe('el cliente Supabase prefiere runtime y conserva el fallback', () => {
  const source = readFileSync('src/lib/supabase.ts', 'utf8');

  it('lee la configuración de runtime', () => {
    expect(source).toContain('readRuntimeConfig');
  });

  it('mantiene VITE_* como respaldo', () => {
    expect(source).toContain('VITE_SUPABASE_URL');
    expect(source).toContain('VITE_SUPABASE_ANON_KEY');
  });

  it('conserva el fail-closed cuando no hay configuración', () => {
    expect(source).toContain('isSupabaseConfigured');
    expect(source).toMatch(/isSupabaseConfigured\s*\n?\s*\?\s*createClient/);
  });
});
