import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackoffDocumentTransport } from '../../src/lib/documentTransport';
import { ApiRateLimitError, resetApiBackoffState } from '../../src/lib/apiBackoff';
import { composeFileName, uploadClientDocument, type DocumentTransport } from '../../src/lib/documentUpload';

// ====================================================================
// Captura del expediente desde la PWA del técnico.
//
// Lo que de verdad se prueba aquí es el transporte: que la PWA conserve su
// backoff de 429 es la razón por la que el control compartido recibe el
// transporte por parámetro. Si alguien lo cambiara por `apiClient`, el técnico
// con mala señal machacaría la API en bucle — y eso sí se demuestra, porque el
// backoff es lógica, no render.
//
// LO QUE NO SE DEMUESTRA, y no puede demostrarse sin un móvil real: que
// `capture` abra la cámara, y que la compresión produzca una imagen en la que
// se lea una INE. El emulador de escritorio tampoco vale para lo primero.
// ====================================================================

const pwa = readFileSync('src/modules/tech-pwa/TechPwaModule.tsx', 'utf8');
const control = readFileSync('src/components/DocumentUploadControl.tsx', 'utf8');

const headers = async () => ({ Authorization: 'Bearer t' });

const jsonResponse = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

describe('el transporte de la PWA conserva el backoff', () => {
  beforeEach(() => resetApiBackoffState());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiBackoffState();
  });

  it('un 429 sale como ApiRateLimitError, no como un error genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } })));
    const transport = createBackoffDocumentTransport(headers);

    const err = await transport
      .get('/api/clients/c-1/documents')
      .then(() => null, (e: unknown) => e);

    // Ésta es la propiedad que se perdería usando `apiClient`.
    expect(err).toBeInstanceOf(ApiRateLimitError);
    expect((err as ApiRateLimitError).retryAfterMs).toBeGreaterThanOrEqual(30000);
  });

  it('tras un 429 el siguiente intento se corta en frío, sin tocar la red', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}, { status: 429, headers: { 'retry-after': '30' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const transport = createBackoffDocumentTransport(headers);

    await transport.get('/api/clients/c-1/documents').catch(() => {});
    const second = await transport
      .get('/api/clients/c-1/documents')
      .then(() => null, (e: unknown) => e);

    expect(second).toBeInstanceOf(ApiRateLimitError);
    expect((second as ApiRateLimitError).fromCooldown).toBe(true);
    // El cooldown evita el bucle: la segunda llamada no llega a salir.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('adjunta las cabeceras de auth y serializa el cuerpo', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);

    await createBackoffDocumentTransport(headers).post('/api/clients/c-1/documents', { documentId: 'doc-1' });

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ documentId: 'doc-1' }));
  });

  it('propaga el mensaje del backend en vez de uno genérico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Customer not found' }, { status: 404 })));

    await expect(
      createBackoffDocumentTransport(headers).get('/api/clients/c-x/documents'),
    ).rejects.toThrow('Customer not found');
  });

  it('cumple la forma que el control compartido espera', () => {
    const transport: DocumentTransport = createBackoffDocumentTransport(headers);
    for (const method of ['get', 'post', 'delete'] as const) {
      expect(typeof transport[method]).toBe('function');
    }
  });
});

describe('INE frente y reverso — mismo doc_type, nombres distintos', () => {
  it('compone el nombre conservando la extensión', () => {
    // La cámara entrega `IMG_20260808_112233.jpg`, que no distingue nada.
    expect(composeFileName('ine-frente', 'IMG_20260808_112233.jpg')).toBe('ine-frente.jpg');
    expect(composeFileName('ine-reverso', 'IMG_20260808_112240.jpg')).toBe('ine-reverso.jpg');
  });

  it('sin prefijo respeta el nombre original', () => {
    expect(composeFileName(undefined, 'contrato.pdf')).toBe('contrato.pdf');
    expect(composeFileName('  ', 'contrato.pdf')).toBe('contrato.pdf');
  });

  it('un archivo sin extensión no gana una inventada', () => {
    expect(composeFileName('ine-frente', 'captura')).toBe('ine-frente');
  });

  it('las dos casillas producen rutas distintas para el mismo doc_type', async () => {
    const nombres: string[] = [];
    const transport = {
      get: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(async (url: string, body?: unknown) => {
        if (url.endsWith('/upload-url')) {
          nombres.push((body as { fileName: string }).fileName);
          return { documentId: `doc-${nombres.length}`, uploadUrl: 'https://bucket/x', storagePath: 'p' };
        }
        return { id: 'doc', fileName: 'x', docType: 'ine' };
      }),
    } as unknown as DocumentTransport;

    const foto = { name: 'IMG_0001.jpg', type: 'image/jpeg', size: 900 * 1024 };
    for (const prefix of ['ine-frente', 'ine-reverso']) {
      await uploadClientDocument({
        clientId: 'c-1',
        docType: 'ine',
        file: foto,
        transport,
        putObject: vi.fn(),
        fileNamePrefix: prefix,
      });
    }

    // El backend deriva la ruta de (documentId, fileName): con el mismo
    // doc_type, el nombre es lo único que las separa en el bucket.
    expect(nombres).toEqual(['ine-frente.jpg', 'ine-reverso.jpg']);
  });

  it('el nombre compuesto es el mismo al firmar y al registrar', async () => {
    const cuerpos: { fileName: string }[] = [];
    const transport = {
      get: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(async (url: string, body?: unknown) => {
        cuerpos.push(body as { fileName: string });
        return url.endsWith('/upload-url')
          ? { documentId: 'doc-1', uploadUrl: 'https://bucket/x', storagePath: 'p' }
          : { id: 'doc-1', fileName: 'ine-frente.jpg', docType: 'ine' };
      }),
    } as unknown as DocumentTransport;

    await uploadClientDocument({
      clientId: 'c-1',
      docType: 'ine',
      file: { name: 'IMG_0001.png', type: 'image/png', size: 3 * 1024 * 1024 },
      transport,
      putObject: vi.fn(),
      fileNamePrefix: 'ine-frente',
      // Comprimir reescribe la extensión a .jpg: el nombre compuesto debe
      // salir de ahí, no del original, o las dos rutas divergirían.
      encodeImage: async () => ({ name: 'IMG_0001.jpg', type: 'image/jpeg', size: 250 * 1024 }),
    });

    expect(cuerpos[0].fileName).toBe('ine-frente.jpg');
    expect(cuerpos[1].fileName).toBe(cuerpos[0].fileName);
  });
});

describe('el montaje en la orden de trabajo', () => {
  it('inyecta el transporte de la PWA, no el del CRM', () => {
    expect(pwa).toContain('createBackoffDocumentTransport(getAuthHeaders)');
    expect(pwa).toContain('transport={documentTransport}');
    // Si esto cambiara a `apiClient`, la PWA perdería el backoff de 429.
    const imports = pwa.split('\n').filter((l) => l.startsWith('import')).join('\n');
    expect(imports).not.toContain('apiClient');
    expect(imports).not.toContain('createAuthorizedApi');
  });

  it('una orden SIN clientId no muestra el control', () => {
    // `clientId` es opcional en WorkOrder: sin cliente no hay expediente, así
    // que se oculta en vez de fallar al pulsarlo.
    expect(pwa).toContain('{o.clientId && (');
    expect(pwa).toContain('clientId={o.clientId}');
  });

  it('monta las tres casillas con nombres distintos', () => {
    for (const prefix of ['ine-frente', 'ine-reverso', 'instalacion']) {
      expect(pwa, `falta la casilla ${prefix}`).toContain(`fileNamePrefix="${prefix}"`);
    }
  });

  it('las dos casillas de INE comparten doc_type', () => {
    expect((pwa.match(/docTypes=\{\['ine'\]\}/g) ?? []).length).toBe(2);
    expect(pwa).toContain("docTypes={['installation_photo']}");
    // Cambiar el CHECK obligaría a una migración para algo que la ruta ya dice.
    expect(pwa).not.toContain('ine_frente');
    expect(pwa).not.toContain('ine_reverso');
  });

  it('los ids del DOM se separan por orden: no colisionan entre tarjetas', () => {
    expect(pwa).toMatch(/idPrefix=\{`tech-pwa-ine-frente-\$\{o\.id\}`\}/);
  });

  it('captura desde la cámara', () => {
    expect((pwa.match(/captureFromCamera/g) ?? []).length).toBe(3);
    expect(control).toContain("accept={captureFromCamera ? 'image/*'");
    expect(control).toContain("capture: 'environment'");
  });
});

describe('sin cola offline — donde más se nota', () => {
  it('el control sigue deshabilitándose sin conexión', () => {
    // El técnico está justo donde peor va la red: que vea que no puede subir es
    // mejor que creer que subió y descubrirlo al salir de casa del cliente.
    expect(control).toContain('useOnlineStatus');
    expect(control).toContain('No se guarda nada en cola.');
  });

  it('la subida NO entra en la cola offline de la PWA', () => {
    // `queueOffline` guarda acciones de orden en localStorage. Un archivo no
    // cabe ahí y encolarlo sería justo lo que la decisión del usuario descarta.
    const bloque = pwa.slice(pwa.indexOf('tech-pwa-expediente-'), pwa.indexOf('Evidencia'));
    expect(bloque).not.toContain('queueOffline');
    expect(bloque).not.toContain('OFFLINE_KEY');
  });
});
