import { describe, expect, it, vi } from 'vitest';
import {
  DocumentUploadError,
  IMAGE_COMPRESSION,
  MAX_DOCUMENT_BYTES,
  compressIfImage,
  countDocumentsByType,
  countDocumentsWithFile,
  describeDeletion,
  hasStoredFile,
  isCompressibleImage,
  isDeletableDocument,
  uploadClientDocument,
  validateDocumentFile,
  validateDocumentSize,
  validateDocumentType,
  type DocumentTransport,
  type UploadableFile,
} from '../../src/lib/documentUpload';
import { clientActionCaps } from '../../src/lib/rbac';

// ====================================================================
// Pieza de subida compartida.
//
// Toda la lógica vive aquí, fuera de React, porque el repo corre los tests en
// `environment: 'node'`: lo que quede dentro del .tsx sólo se puede verificar
// leyendo el source. Por eso el componente es un cascarón y esto es lo que se
// ejercita de verdad.
//
// LO QUE NO SE DEMUESTRA AQUÍ: el `PUT` a la URL firmada. `putObject` es un
// doble; que Supabase Storage acepte ese PUT con el token en query sólo se
// comprueba contra Supabase real. Tampoco se demuestra la compresión real:
// no hay canvas en Node, así que se verifica A QUIÉN se llama y con qué
// parámetros, no cuántos píxeles salen.
// ====================================================================

const file = (over: Partial<UploadableFile> = {}): UploadableFile => ({
  name: 'ine.jpg',
  type: 'image/jpeg',
  size: 3 * 1024 * 1024,
  ...over,
});

const transportSpy = (over: Partial<Record<'upload-url' | 'documents' | 'orphan-cleanup', unknown>> = {}) => {
  const post = vi.fn(async (url: string, _body?: unknown) => {
    if (url.endsWith('/upload-url')) {
      const stub = over['upload-url'];
      if (stub instanceof Error) throw stub;
      return stub ?? { documentId: 'doc-1', uploadUrl: 'https://bucket/signed', storagePath: 't/c/doc-1-ine.jpg' };
    }
    if (url.endsWith('/orphan-cleanup')) {
      const stub = over['orphan-cleanup'];
      if (stub instanceof Error) throw stub;
      return stub ?? { ok: true };
    }
    const stub = over.documents;
    if (stub instanceof Error) throw stub;
    return stub ?? { id: 'doc-1', fileName: 'ine.jpg', docType: 'ine' };
  });
  const transport: DocumentTransport = { get: vi.fn(), post, delete: vi.fn() } as unknown as DocumentTransport;
  return { transport, post };
};

const urlsPosted = (post: ReturnType<typeof vi.fn>): string[] =>
  post.mock.calls.map((c) => String(c[0]));

/** El error de una promesa que DEBE fallar. */
const failureOf = (p: Promise<unknown>): Promise<DocumentUploadError> =>
  p.then(
    () => {
      throw new Error('se esperaba un fallo y la subida salió bien');
    },
    (e: unknown) => e as DocumentUploadError,
  );

describe('validación del archivo — antes de gastar una firma', () => {
  it('rechaza un MIME no admitido', () => {
    const res = validateDocumentFile(file({ type: 'application/zip' }));
    expect(res).toMatchObject({ ok: false, code: 'INVALID_MIME_TYPE' });
  });

  it('el tamaño NO se juzga antes de comprimir', () => {
    // Este test afirmaba lo contrario y consagraba un defecto: una foto de
    // 12 MB —móvil de 48 MP en HDR, o sea el equipo del técnico en campo— moría
    // con "supera el máximo" sin pasar por el canvas que la deja en 300 KB.
    const enorme = file({ size: MAX_DOCUMENT_BYTES + 1 });
    expect(validateDocumentType(enorme)).toEqual({ ok: true });
    expect(validateDocumentSize(enorme)).toMatchObject({ ok: false, code: 'FILE_TOO_LARGE' });
  });

  it('una foto de 12 MB que comprime a 300 KB SÍ se sube', async () => {
    const { transport, post } = transportSpy();
    const encode = vi.fn(async () => file({ size: 300 * 1024 }));

    await uploadClientDocument({
      clientId: 'c-1',
      docType: 'ine',
      file: file({ size: 12 * 1024 * 1024 }),
      transport,
      putObject: vi.fn(),
      encodeImage: encode,
    });

    expect(encode).toHaveBeenCalled();
    expect(urlsPosted(post)).toContain('/api/clients/c-1/documents');
  });

  it('lo que sigue pasándose de grande DESPUÉS de comprimir sí se rechaza', async () => {
    const { transport, post } = transportSpy();
    // Un PDF no se comprime, así que el límite del bucket se aplica igual.
    await expect(
      uploadClientDocument({
        clientId: 'c-1',
        docType: 'other',
        file: file({ name: 'plano.pdf', type: 'application/pdf', size: 12 * 1024 * 1024 }),
        transport,
        putObject: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    // Y sigue sin gastarse una firma en algo que el bucket rechazaría.
    expect(post).not.toHaveBeenCalled();
  });

  it('rechaza un archivo vacío', () => {
    expect(validateDocumentFile(file({ size: 0 }))).toMatchObject({ ok: false, code: 'EMPTY_FILE' });
  });

  it('acepta PDF y las tres imágenes del bucket', () => {
    for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']) {
      expect(validateDocumentFile(file({ type })), type).toEqual({ ok: true });
    }
  });

  it('el MIME se rechaza SIN pedir la URL firmada', async () => {
    const { transport, post } = transportSpy();

    await expect(
      uploadClientDocument({
        clientId: 'c-1',
        docType: 'ine',
        file: file({ type: 'application/zip' }),
        transport,
        putObject: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_MIME_TYPE' });

    // Una firma gastada en algo que el bucket va a rechazar es una firma tirada.
    expect(post).not.toHaveBeenCalled();
  });
});

describe('compresión — imágenes sí, PDF no', () => {
  it('un PDF no pasa por el encoder', async () => {
    const encode = vi.fn();
    const pdf = file({ name: 'contrato.pdf', type: 'application/pdf' });

    const out = await compressIfImage(pdf, encode);

    // Pasar un PDF por un canvas lo convertiría en una foto de la primera página.
    expect(encode).not.toHaveBeenCalled();
    expect(out).toBe(pdf);
  });

  it('una imagen sí, con 1600 px y q0.8', async () => {
    const small = file({ name: 'ine.jpg', size: 300 * 1024 });
    const encode = vi.fn(async () => small);

    const out = await compressIfImage(file({ size: 4 * 1024 * 1024 }), encode);

    expect(encode).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }), IMAGE_COMPRESSION);
    expect(IMAGE_COMPRESSION).toEqual({ maxDimension: 1600, quality: 0.8 });
    expect(out).toBe(small);
  });

  it('isCompressibleImage distingue los tipos', () => {
    expect(isCompressibleImage('image/jpeg')).toBe(true);
    expect(isCompressibleImage('image/png')).toBe(true);
    expect(isCompressibleImage('image/webp')).toBe(true);
    expect(isCompressibleImage('application/pdf')).toBe(false);
  });

  it('si comprimir no reduce el tamaño, se queda el original', async () => {
    const original = file({ size: 100 * 1024 });
    const encode = vi.fn(async () => file({ size: 400 * 1024 }));

    expect(await compressIfImage(original, encode)).toBe(original);
  });

  it('si el encoder falla, la subida sigue con el original', async () => {
    const original = file();
    const encode = vi.fn(async () => {
      throw new Error('canvas no disponible');
    });

    // Comprimir es una optimización; que falle no puede impedir subir la INE.
    expect(await compressIfImage(original, encode)).toBe(original);
  });
});

describe('los tres pasos', () => {
  it('firma, sube los bytes y registra, en ese orden', async () => {
    const { transport, post } = transportSpy();
    const putObject = vi.fn();

    const doc = await uploadClientDocument({
      clientId: 'c-1',
      docType: 'ine',
      file: file(),
      transport,
      putObject,
    });

    expect(urlsPosted(post)).toEqual([
      '/api/clients/c-1/documents/upload-url',
      '/api/clients/c-1/documents',
    ]);
    expect(putObject).toHaveBeenCalledWith('https://bucket/signed', expect.objectContaining({ name: 'ine.jpg' }));
    expect(doc).toMatchObject({ id: 'doc-1' });
  });

  it('registra con el documentId que devolvió la firma, no con uno propio', async () => {
    const { transport, post } = transportSpy({
      'upload-url': { documentId: 'doc-emitido', uploadUrl: 'https://bucket/x', storagePath: 'p' },
    });

    await uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject: vi.fn() });

    expect(post).toHaveBeenLastCalledWith(
      '/api/clients/c-1/documents',
      expect.objectContaining({ documentId: 'doc-emitido' }),
    );
  });

  it('manda el MISMO fileName al firmar y al registrar', async () => {
    // El backend deriva la ruta de (documentId, fileName) en los DOS pasos. Un
    // nombre distinto aquí —el comprimido, por ejemplo— registraría la fila
    // sobre un objeto que no existe, y la descarga daría 404 para siempre.
    const { transport, post } = transportSpy();
    const encode = vi.fn(async () => file({ name: 'ine-comprimida.jpg', size: 200 * 1024 }));

    await uploadClientDocument({
      clientId: 'c-1',
      docType: 'ine',
      file: file(),
      transport,
      putObject: vi.fn(),
      encodeImage: encode,
    });

    const [, firmar] = post.mock.calls[0] as [string, { fileName: string }];
    const [, registrar] = post.mock.calls[1] as [string, { fileName: string }];
    expect(firmar.fileName).toBe('ine-comprimida.jpg');
    expect(registrar.fileName).toBe(firmar.fileName);
  });

  it('nunca manda storagePath: la ruta la deriva el backend', async () => {
    const { transport, post } = transportSpy();

    await uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject: vi.fn() });

    const [, registrar] = post.mock.calls[1] as [string, Record<string, unknown>];
    expect(registrar).not.toHaveProperty('storagePath');
  });

  it('nunca manda docType contract: lo emite sólo el flujo de firma', async () => {
    const { transport, post } = transportSpy();

    await uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject: vi.fn() });

    const [, registrar] = post.mock.calls[1] as [string, { docType: string }];
    expect(registrar.docType).not.toBe('contract');
  });
});

describe('sin conexión no se encola nada', () => {
  it('falla explícitamente y no toca la red', async () => {
    const { transport, post } = transportSpy();
    const putObject = vi.fn();

    await expect(
      uploadClientDocument({
        clientId: 'c-1',
        docType: 'ine',
        file: file(),
        transport,
        putObject,
        isOnline: false,
      }),
    ).rejects.toMatchObject({ code: 'OFFLINE' });

    expect(post).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('compensación del huérfano', () => {
  it('si el registro falla, pide borrar el objeto que ya se subió', async () => {
    const { transport, post } = transportSpy({ documents: new Error('500 boom') });

    const err = await failureOf(
      uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject: vi.fn() }),
    );

    expect(err).toBeInstanceOf(DocumentUploadError);
    expect(err.code).toBe('REGISTER_FAILED');
    expect(post).toHaveBeenLastCalledWith(
      '/api/clients/c-1/documents/orphan-cleanup',
      { documentId: 'doc-1', fileName: 'ine.jpg' },
    );
    expect(err.orphanLeft).toBe(false);
  });

  it('si la compensación también falla, lo dice en vez de callarlo', async () => {
    const { transport } = transportSpy({
      documents: new Error('500'),
      'orphan-cleanup': new Error('también 500'),
    });

    const err = await failureOf(
      uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject: vi.fn() }),
    );

    // Queda basura en el bucket. Es basura, no corrupción, pero se reporta.
    expect(err.orphanLeft).toBe(true);
  });

  it('si el PUT falla no hay nada que compensar', async () => {
    const { transport, post } = transportSpy();
    const putObject = vi.fn(async () => {
      throw new Error('red caída');
    });

    await expect(
      uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject }),
    ).rejects.toMatchObject({ code: 'PUT_FAILED' });

    expect(urlsPosted(post)).not.toContain('/api/clients/c-1/documents/orphan-cleanup');
  });

  it('si la firma falla, no se sube nada', async () => {
    const { transport } = transportSpy({ 'upload-url': new Error('403') });
    const putObject = vi.fn();

    await expect(
      uploadClientDocument({ clientId: 'c-1', docType: 'ine', file: file(), transport, putObject }),
    ).rejects.toMatchObject({ code: 'SIGN_FAILED' });
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('lectura del expediente', () => {
  const docs = [
    { id: 'd1', docType: 'ine', fileName: 'frente.jpg', createdAt: '2026-08-01', storagePath: 't/c/d1-frente.jpg' },
    { id: 'd2', docType: 'ine', fileName: 'reverso.jpg', createdAt: '2026-08-01', storagePath: 't/c/d2-reverso.jpg' },
    { id: 'd3', docType: 'receipt', fileName: 'recibo.pdf', createdAt: '2026-08-02', storagePath: 't/c/d3-recibo.pdf' },
    // La basura que dejó el addDocument anterior: fila sin archivo.
    { id: 'd4', docType: 'contract', fileName: 'contrato', createdAt: '2026-07-01' },
  ];

  it('una fila sin storage_path se marca, no se oculta', () => {
    expect(hasStoredFile(docs[0])).toBe(true);
    expect(hasStoredFile(docs[3])).toBe(false);
    // Sigue estando en la lista: esconderla taparía el rastro del problema.
    expect(docs).toHaveLength(4);
  });

  it('cuenta por tipo para el sidebar', () => {
    expect(countDocumentsByType(docs)).toEqual({ ine: 2, receipt: 1, contract: 1 });
  });

  it('el conteo con archivo excluye las filas fantasma', () => {
    expect(countDocumentsWithFile(docs)).toBe(3);
  });
});

describe('isDeletableDocument — el mismo criterio que la guardia del backend', () => {
  const doc = (over: Partial<{ docType: string; storagePath: string }> = {}) => ({
    id: 'd', docType: 'other', fileName: 'x.pdf', createdAt: '2026-08-01', ...over,
  });

  it('el PDF de un contrato NO ofrece borrado: el backend responde 409', () => {
    // Ofrecer un botón que siempre falla es peor que no ofrecerlo.
    expect(isDeletableDocument(doc({ docType: 'contract', storagePath: 't/c/d-contrato.pdf' }))).toBe(false);
  });

  it('la fila fantasma —contract SIN archivo— sí', () => {
    // Es la basura que este trabajo viene a limpiar: el matiz es el mismo que
    // aplica el DELETE del backend.
    expect(isDeletableDocument(doc({ docType: 'contract' }))).toBe(true);
  });

  it('cualquier otro tipo con archivo, también', () => {
    for (const docType of ['ine', 'receipt', 'installation_photo', 'other']) {
      expect(isDeletableDocument(doc({ docType, storagePath: 't/c/d-x.jpg' })), docType).toBe(true);
    }
  });
});

describe('describeDeletion — traduce lo que el backend decidió', () => {
  it('el caso normal', () => {
    expect(describeDeletion({ objectRemoved: true })).toMatch(/archivo eliminados/);
  });

  it('objeto compartido: dice que el archivo se conserva', () => {
    const msg = describeDeletion({ objectRemoved: false, objectRetainedReason: 'shared_by_other_documents' });
    expect(msg).toMatch(/se conserva/);
  });

  it('fila fantasma: dice que no tenía archivo', () => {
    const msg = describeDeletion({ objectRemoved: false, objectRetainedReason: 'no_storage_object' });
    expect(msg).toMatch(/sin archivo|No tenía archivo/i);
  });

  it('un motivo desconocido no miente diciendo que borró el archivo', () => {
    const msg = describeDeletion({ objectRemoved: false, objectRetainedReason: 'motivo_nuevo' });
    expect(msg).not.toMatch(/archivo eliminado/i);
  });
});

describe('RBAC — la cap de documentos NO es editClient', () => {
  it('soporte y cobranza SÍ gestionan documentos', () => {
    // Es justo lo que se perdería reutilizando `editClient`: el WRITE del
    // backend (routes.ts:8) les concede la escritura, así que ocultarles el
    // control sería quitarles en la UI algo que la API sí les permite.
    expect(clientActionCaps('Soporte').manageDocuments).toBe(true);
    expect(clientActionCaps('Cobranza').manageDocuments).toBe(true);
  });

  it('y editClient NO los cubre — por eso hizo falta una cap nueva', () => {
    expect(clientActionCaps('Soporte').editClient).toBe(false);
    expect(clientActionCaps('Cobranza').editClient).toBe(false);
  });

  it('los roles de escritura del backend coinciden uno a uno', () => {
    for (const role of ['Super Admin', 'Administrador', 'Técnico', 'Soporte', 'Cobranza'] as const) {
      expect(clientActionCaps(role).manageDocuments, role).toBe(true);
    }
  });

  it('solo lectura y rol desconocido no', () => {
    expect(clientActionCaps('Solo lectura').manageDocuments).toBe(false);
    expect(clientActionCaps('NoExiste' as never).manageDocuments).toBe(false);
  });
});
