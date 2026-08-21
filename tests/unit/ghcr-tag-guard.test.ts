import { describe, expect, it, vi } from 'vitest';

import {
  GHCR_API_BASE,
  GHCR_TOKEN_ENDPOINT,
  GhcrGuardError,
  OCI_REPOSITORY,
  assertTagsAbsent,
  checkManifestAbsent,
  fetchRegistryBearer,
  runCheckGhcrTagsAbsentCli,
} from '../../scripts/check-ghcr-tags-absent.mjs';

// ====================================================================
// Autenticación del Registry v2 contra GHCR.
//
// EL ERROR QUE ESTO CORRIGE
//
// La primera versión hacía `base64(GITHUB_TOKEN)` y lo mandaba como bearer.
// Eso confunde dos cosas distintas: la CREDENCIAL (usuario + GITHUB_TOKEN,
// que sólo sirve como Basic ante el token service) y el BEARER OPACO que el
// token service devuelve y que es lo único que acepta `/v2/.../manifests/`.
// `docker/login-action` guarda credenciales para el cliente Docker; un `curl`
// aparte no hereda esa sesión.
//
// Todo aquí es hermético: se inyecta `fetch`, nunca se contacta GHCR real.
// ====================================================================

const ACTOR = 'nugacorp';
const PASSWORD = 'ghs_TOKEN_QUE_NUNCA_DEBE_APARECER';
const OPAQUE = 'OPAQUE_REGISTRY_BEARER_abc123';

const jsonResponse = (status: number, body: unknown, ok = status >= 200 && status < 300) => ({
  ok,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const statusResponse = (status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => '',
});

/** fetch falso: primera llamada = token service, siguientes = manifests. */
const makeFetch = (opts: {
  token?: unknown;
  tokenStatus?: number;
  manifestStatuses?: number[];
  tokenThrows?: Error;
  manifestThrows?: Error;
}) => {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  let manifestIndex = 0;
  const impl = vi.fn(async (url: string, init: Record<string, unknown> = {}) => {
    calls.push({ url, init });
    if (url.startsWith(GHCR_TOKEN_ENDPOINT)) {
      if (opts.tokenThrows) throw opts.tokenThrows;
      return jsonResponse(opts.tokenStatus ?? 200, opts.token ?? { token: OPAQUE });
    }
    if (opts.manifestThrows) throw opts.manifestThrows;
    const status = opts.manifestStatuses?.[manifestIndex] ?? 404;
    manifestIndex += 1;
    return statusResponse(status);
  });
  return { impl, calls };
};

describe('token service: Basic → bearer opaco', () => {
  it('pide el token con service y scope de pull sobre el repositorio fijo', async () => {
    const { impl, calls } = makeFetch({});

    await fetchRegistryBearer({ actor: ACTOR, password: PASSWORD, fetchImpl: impl });

    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(GHCR_TOKEN_ENDPOINT);
    expect(url.searchParams.get('service')).toBe('ghcr.io');
    expect(url.searchParams.get('scope')).toBe(`repository:${OCI_REPOSITORY}:pull`);
  });

  it('autentica con Basic(actor:token), no con el token pelado', async () => {
    const { impl, calls } = makeFetch({});

    await fetchRegistryBearer({ actor: ACTOR, password: PASSWORD, fetchImpl: impl });

    const headers = calls[0].init.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from(`${ACTOR}:${PASSWORD}`).toString('base64')}`;
    expect(headers.Authorization).toBe(expected);
  });

  it('acepta la respuesta con el campo `token`', async () => {
    const { impl } = makeFetch({ token: { token: OPAQUE } });
    await expect(fetchRegistryBearer({ actor: ACTOR, password: PASSWORD, fetchImpl: impl }))
      .resolves.toBe(OPAQUE);
  });

  it('acepta la respuesta con el campo `access_token`', async () => {
    const { impl } = makeFetch({ token: { access_token: OPAQUE } });
    await expect(fetchRegistryBearer({ actor: ACTOR, password: PASSWORD, fetchImpl: impl }))
      .resolves.toBe(OPAQUE);
  });

  const tokenFailures: Array<[string, Parameters<typeof makeFetch>[0], RegExp]> = [
    ['401 del token service', { tokenStatus: 401, token: {} }, /401/],
    ['403 del token service', { tokenStatus: 403, token: {} }, /403/],
    ['500 del token service', { tokenStatus: 500, token: {} }, /500/],
    ['JSON inválido', { token: 'no-es-json{' }, /JSON/i],
    ['token ausente', { token: { expires_in: 300 } }, /token/i],
    ['token vacío', { token: { token: '   ' } }, /token/i],
    ['token no string', { token: { token: 42 } }, /token/i],
  ];

  for (const [label, opts, pattern] of tokenFailures) {
    it(`falla cerrado ante ${label}`, async () => {
      const { impl } = makeFetch(opts);
      await expect(fetchRegistryBearer({ actor: ACTOR, password: PASSWORD, fetchImpl: impl }))
        .rejects.toThrow(pattern);
    });
  }

  it('falla cerrado si el token service no responde', async () => {
    const { impl } = makeFetch({ tokenThrows: new Error('ENOTFOUND ghcr.io') });
    await expect(fetchRegistryBearer({ actor: ACTOR, password: PASSWORD, fetchImpl: impl }))
      .rejects.toThrow(GhcrGuardError);
  });

  it('exige actor y contraseña', async () => {
    const { impl } = makeFetch({});
    await expect(fetchRegistryBearer({ actor: '', password: PASSWORD, fetchImpl: impl }))
      .rejects.toThrow(/actor/i);
    await expect(fetchRegistryBearer({ actor: ACTOR, password: '', fetchImpl: impl }))
      .rejects.toThrow(/credencial/i);
  });
});

describe('consulta de manifest', () => {
  it('usa EXACTAMENTE el token devuelto por el token service como bearer', async () => {
    const { impl, calls } = makeFetch({ manifestStatuses: [404] });

    await assertTagsAbsent({ actor: ACTOR, password: PASSWORD, tags: ['2.0.0'], fetchImpl: impl });

    const manifestCall = calls.find((c) => c.url.includes('/manifests/'))!;
    const headers = manifestCall.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${OPAQUE}`);
    // Y NUNCA el base64 del GITHUB_TOKEN, que era el error original.
    expect(headers.Authorization).not.toContain(Buffer.from(PASSWORD).toString('base64'));
    expect(headers.Authorization).not.toContain(PASSWORD);
  });

  it('apunta al repositorio fijo y pide los media types de manifest', async () => {
    const { impl, calls } = makeFetch({ manifestStatuses: [404] });

    await checkManifestAbsent({ bearer: OPAQUE, tag: '2.0.0', fetchImpl: impl });

    const call = calls[0];
    expect(call.url).toBe(`${GHCR_API_BASE}/${OCI_REPOSITORY}/manifests/2.0.0`);
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Accept).toContain('application/vnd.oci.image.index.v1+json');
    expect(headers.Accept).toContain('application/vnd.docker.distribution.manifest.list.v2+json');
  });

  it('404 significa etiqueta libre', async () => {
    const { impl } = makeFetch({ manifestStatuses: [404] });
    await expect(checkManifestAbsent({ bearer: OPAQUE, tag: '2.0.0', fetchImpl: impl }))
      .resolves.toBe(true);
  });

  it('200 significa etiqueta ocupada y aborta', async () => {
    const { impl } = makeFetch({ manifestStatuses: [200] });
    await expect(checkManifestAbsent({ bearer: OPAQUE, tag: '2.0.0', fetchImpl: impl }))
      .rejects.toThrow(/YA EXISTE/i);
  });

  const manifestFailures: Array<[number, RegExp]> = [
    [401, /no prueba ausencia/i],
    [403, /no prueba ausencia/i],
    [429, /no prueba ausencia/i],
    [500, /no prueba ausencia/i],
    [502, /no prueba ausencia/i],
    [503, /no prueba ausencia/i],
    [418, /indeterminad/i],
    [302, /indeterminad/i],
  ];

  for (const [status, pattern] of manifestFailures) {
    it(`falla cerrado ante ${status}`, async () => {
      const { impl } = makeFetch({ manifestStatuses: [status] });
      await expect(checkManifestAbsent({ bearer: OPAQUE, tag: '2.0.0', fetchImpl: impl }))
        .rejects.toThrow(pattern);
    });
  }

  it('falla cerrado ante error de red o timeout', async () => {
    const { impl } = makeFetch({ manifestThrows: new Error('The operation was aborted') });
    await expect(checkManifestAbsent({ bearer: OPAQUE, tag: '2.0.0', fetchImpl: impl }))
      .rejects.toThrow(/no prueba que la etiqueta esté libre/i);
  });
});

describe('comprobación de las dos etiquetas', () => {
  it('consulta ambas cuando la primera está libre', async () => {
    const { impl, calls } = makeFetch({ manifestStatuses: [404, 404] });

    await assertTagsAbsent({
      actor: ACTOR,
      password: PASSWORD,
      tags: ['2.0.0', 'sha-59d8b78c6588c3971efd5f3d28d3bc44ae1251d5'],
      fetchImpl: impl,
    });

    const manifests = calls.filter((c) => c.url.includes('/manifests/')).map((c) => c.url);
    expect(manifests).toHaveLength(2);
    expect(manifests[0]).toContain('/manifests/2.0.0');
    expect(manifests[1]).toContain('/manifests/sha-59d8b78c6588c3971efd5f3d28d3bc44ae1251d5');
  });

  it('aborta en la primera ocupada sin consultar la segunda', async () => {
    const { impl, calls } = makeFetch({ manifestStatuses: [200, 404] });

    await expect(assertTagsAbsent({
      actor: ACTOR, password: PASSWORD, tags: ['2.0.0', 'sha-abc'], fetchImpl: impl,
    })).rejects.toThrow(/YA EXISTE/i);

    expect(calls.filter((c) => c.url.includes('/manifests/'))).toHaveLength(1);
  });

  it('pide el bearer una sola vez para ambas etiquetas', async () => {
    const { impl, calls } = makeFetch({ manifestStatuses: [404, 404] });

    await assertTagsAbsent({ actor: ACTOR, password: PASSWORD, tags: ['a', 'b'], fetchImpl: impl });

    expect(calls.filter((c) => c.url.startsWith(GHCR_TOKEN_ENDPOINT))).toHaveLength(1);
  });

  it('exige al menos una etiqueta', async () => {
    const { impl } = makeFetch({});
    await expect(assertTagsAbsent({ actor: ACTOR, password: PASSWORD, tags: [], fetchImpl: impl }))
      .rejects.toThrow(/etiqueta/i);
  });
});

describe('ningún secreto llega a los logs', () => {
  const captureLogs = () => {
    const lines: string[] = [];
    const push = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    return { log: { log: push, error: push }, lines };
  };

  it('una ejecución correcta no imprime credencial ni bearer', async () => {
    const { impl } = makeFetch({ manifestStatuses: [404, 404] });
    const { log, lines } = captureLogs();

    const code = await runCheckGhcrTagsAbsentCli({
      argv: ['2.0.0', 'sha-abc'],
      env: { GITHUB_ACTOR: ACTOR, GITHUB_TOKEN: PASSWORD },
      log,
      fetchImpl: impl,
    });

    expect(code).toBe(0);
    const output = lines.join('\n');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(OPAQUE);
    expect(output).not.toContain(Buffer.from(PASSWORD).toString('base64'));
    expect(output).not.toMatch(/Basic /);
  });

  it('un fallo tampoco los imprime, ni siquiera la respuesta del token service', async () => {
    const { impl } = makeFetch({ tokenStatus: 401, token: { details: PASSWORD } });
    const { log, lines } = captureLogs();

    const code = await runCheckGhcrTagsAbsentCli({
      argv: ['2.0.0', 'sha-abc'],
      env: { GITHUB_ACTOR: ACTOR, GITHUB_TOKEN: PASSWORD },
      log,
      fetchImpl: impl,
    });

    expect(code).toBe(1);
    const output = lines.join('\n');
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(OPAQUE);
  });

  it('el CLI devuelve 1 cuando una etiqueta ya existe', async () => {
    const { impl } = makeFetch({ manifestStatuses: [200] });
    const { log } = captureLogs();

    await expect(runCheckGhcrTagsAbsentCli({
      argv: ['2.0.0', 'sha-abc'],
      env: { GITHUB_ACTOR: ACTOR, GITHUB_TOKEN: PASSWORD },
      log,
      fetchImpl: impl,
    })).resolves.toBe(1);
  });

  it('el CLI exige actor, token y las dos etiquetas', async () => {
    const { impl } = makeFetch({});
    const { log } = captureLogs();
    const base = { log, fetchImpl: impl };

    await expect(runCheckGhcrTagsAbsentCli({
      ...base, argv: ['2.0.0'], env: { GITHUB_ACTOR: ACTOR },
    })).resolves.toBe(1);
    await expect(runCheckGhcrTagsAbsentCli({
      ...base, argv: [], env: { GITHUB_ACTOR: ACTOR, GITHUB_TOKEN: PASSWORD },
    })).resolves.toBe(1);
  });
});

describe('el repositorio OCI está fijado', () => {
  it('no se acepta desde una entrada no confiable', () => {
    expect(OCI_REPOSITORY).toBe('nugacorp/nugacore-v2');
  });

  it('el CLI sólo recibe etiquetas, nunca el repositorio', async () => {
    const { impl, calls } = makeFetch({ manifestStatuses: [404, 404] });
    const lines: string[] = [];
    const push = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };

    await runCheckGhcrTagsAbsentCli({
      // Un intento de inyectar otro repositorio se trata como etiqueta.
      argv: ['otro-owner/otro-repo:latest', 'sha-abc'],
      env: { GITHUB_ACTOR: ACTOR, GITHUB_TOKEN: PASSWORD },
      log: { log: push, error: push },
      fetchImpl: impl,
    });

    for (const call of calls.filter((c) => c.url.includes('/manifests/'))) {
      expect(call.url.startsWith(`${GHCR_API_BASE}/${OCI_REPOSITORY}/manifests/`)).toBe(true);
    }
  });
});
