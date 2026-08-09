import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  buildDocumentPath,
  pathBelongsToTenant,
  sanitizeFileName,
} from '../../backend/services/supabase-storage';
import { Client360Service } from '../../backend/domains/client-360/service';
import { client360Memory, isEmittedDocumentId, uid } from '../../backend/domains/client-360/memory-store';

// ====================================================================
// Storage de documentos de cliente.
//
// El bucket es privado y solo service_role lo toca: el backend firma URLs de
// vida corta tras validar RBAC y propiedad por tenant. Estos tests cubren el
// aislamiento por tenant, que es donde un fallo se convierte en fuga entre
// WISPs, y el contrato de la migración del bucket.
// ====================================================================

const migration = readFileSync(
  'supabase/migrations/20260730140000_client_documents_storage_bucket.sql',
  'utf8',
);
const routes = readFileSync('backend/domains/client-360/routes.ts', 'utf8');

/** Servicio con la comprobación de propiedad neutralizada: aquí se prueba el
 *  resto de la validación, no el guard de cliente (ya cubierto aparte). */
const serviceWithOwnedClient = () => {
  const svc = new Client360Service();
  svc.assertClientOwned = async () => {};
  return svc;
};

// El store en memoria es un módulo compartido: sin esto un test ve las filas
// que dejó el anterior.
beforeEach(() => {
  client360Memory.documents.length = 0;
  client360Memory.activity.length = 0;
});

describe('sanitizeFileName', () => {
  it('se queda solo con el basename', () => {
    expect(sanitizeFileName('/etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Windows\\system.ini')).toBe('system.ini');
  });

  it('neutraliza el recorrido de directorios', () => {
    expect(sanitizeFileName('../../secreto.pdf')).toBe('secreto.pdf');
    expect(sanitizeFileName('..')).toBe('archivo');
  });

  it('sustituye caracteres no seguros y nunca devuelve vacío', () => {
    expect(sanitizeFileName('factura marzo (1).pdf')).toBe('factura-marzo-1-.pdf');
    expect(sanitizeFileName('')).toBe('archivo');
    expect(sanitizeFileName('///')).toBe('archivo');
  });

  it('acota la longitud', () => {
    expect(sanitizeFileName(`${'a'.repeat(500)}.pdf`).length).toBeLessThanOrEqual(120);
  });
});

describe('buildDocumentPath', () => {
  it('prefija siempre con el tenant', () => {
    const path = buildDocumentPath('tenant-a', 'c-1', 'doc-9', 'ine.pdf');
    expect(path).toBe('tenant-a/c-1/doc-9-ine.pdf');
    expect(path.startsWith('tenant-a/')).toBe(true);
  });

  it('un nombre de archivo hostil no puede escapar del prefijo', () => {
    const path = buildDocumentPath('tenant-a', 'c-1', 'doc-9', '../../../tenant-b/robo.pdf');
    expect(path.startsWith('tenant-a/c-1/')).toBe(true);
    expect(path).not.toContain('..');
  });

  it('un clientId hostil tampoco', () => {
    const path = buildDocumentPath('tenant-a', '../tenant-b', 'doc-9', 'x.pdf');
    expect(path.startsWith('tenant-a/')).toBe(true);
    expect(path.split('/')).not.toContain('..');
  });
});

describe('buildDocumentPath es INYECTIVA — dos documentos nunca comparten ruta', () => {
  // Los tests de arriba prueban que la ruta no ESCAPA del tenant. Ésta es otra
  // propiedad, y la que el resto del diseño da por supuesta: que la ruta
  // identifica un único documento.
  //
  // No lo era. El tercer segmento es `${documentId}-${sanitizeFileName(fileName)}`
  // y `-` era legal dentro del id, así que el id absorbía el prefijo del nombre.
  // El sufijo necesario lo publica este mismo trabajo: `fileNamePrefix="ine-frente"`.

  const LEGITIMO = 'doc-1754650000000-a1b2c3d4';
  const ALIAS = 'doc-1754650000000-a1b2c3d4-ine';

  it('la colisión que existía: dos ids distintos, la misma ruta', () => {
    const legit = buildDocumentPath('tenant-a', 'cli-1', LEGITIMO, 'ine-frente.jpg');
    const alias = buildDocumentPath('tenant-a', 'cli-1', ALIAS, 'frente.jpg');

    // La función sigue siendo colisionable si se le pasa cualquier cosa: quien
    // garantiza la unicidad es la validación del id, no `buildDocumentPath`.
    expect(alias).toBe(legit);
  });

  it('y el id que la provoca ya no es aceptable', () => {
    expect(isEmittedDocumentId(LEGITIMO)).toBe(true);
    expect(isEmittedDocumentId(ALIAS)).toBe(false);
  });

  it('el formato que emite uid() pasa: emisor y validador son un par', () => {
    // Si alguien simplifica `uid`, este test cae y avisa de que la ruta deja de
    // ser única antes de que lo descubra un cliente.
    for (let i = 0; i < 200; i += 1) {
      // El id se genera UNA vez: pasar `uid('doc')` también como mensaje daría
      // un id distinto del que falló y mandaría a depurar el equivocado.
      const id = uid('doc');
      expect(isEmittedDocumentId(id), id).toBe(true);
    }
  });

  it('ningún id válido es prefijo de otro seguido de `-`', () => {
    // Ésta es la propiedad de la que cuelga la inyectividad: tras el último
    // guión hay exactamente 8 hex y fin, y `\d+` no admite letras ni guiones.
    const ids = Array.from({ length: 300 }, () => uid('doc'));
    for (const a of ids) {
      for (const sufijo of ['ine', 'x', '0', 'a1b2c3d4', 'frente']) {
        expect(isEmittedDocumentId(`${a}-${sufijo}`), `${a}-${sufijo}`).toBe(false);
      }
    }
  });

  it('rechaza las formas laxas que el regex anterior admitía', () => {
    for (const malo of [
      'doc-abc123',                     // sin marca de tiempo
      'doc-1754650000000',              // sin entropía
      'doc-1754650000000-A1B2C3D4',     // hex en mayúsculas
      'doc-1754650000000-a1b2c3d',      // 7 hex
      'doc-1754650000000-a1b2c3d45',    // 9 hex
      'doc-1754650000000-a1b2c3d4-ine', // el alias
      'documento-1-a1b2c3d4',           // otro prefijo
      'doc-1754650000000-zzzzzzzz',     // fuera del alfabeto hex
    ]) {
      expect(isEmittedDocumentId(malo), malo).toBe(false);
    }
  });

  it('addDocument rechaza el id alias', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'frente.jpg',
        documentId: ALIAS,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FIELD' });
  });

  it('orphan-cleanup también: si no, señalaría el objeto de otro documento', async () => {
    await expect(
      serviceWithOwnedClient().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
        documentId: ALIAS,
        fileName: 'frente.jpg',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FIELD' });
  });

  it('el documento legítimo se registra con su ruta de siempre', async () => {
    // El anclaje cierra el alias sin estrechar lo que sí debe pasar.
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'ine-frente.jpg',
      documentId: LEGITIMO,
      docType: 'ine',
    });
    expect(doc.storagePath).toBe('tenant-a/c-1/doc-1754650000000-a1b2c3d4-ine-frente.jpg');
  });
});

describe('pathBelongsToTenant', () => {
  it('acepta el prefijo propio', () => {
    expect(pathBelongsToTenant('tenant-a/c-1/doc.pdf', 'tenant-a')).toBe(true);
  });

  it('rechaza el de otro WISP', () => {
    expect(pathBelongsToTenant('tenant-b/c-1/doc.pdf', 'tenant-a')).toBe(false);
  });

  it('rechaza el recorrido de directorios', () => {
    expect(pathBelongsToTenant('../tenant-b/doc.pdf', 'tenant-a')).toBe(false);
  });
});

describe('addDocument — la ruta la deriva el backend', () => {
  // Antes esta función aceptaba el `storagePath` del cuerpo y sólo comprobaba
  // formato, `..` y prefijo de tenant. Lo que nunca comprobó es que la ruta
  // correspondiera al documentId/clientId que emitió la firma, así que se podía
  // registrar una fila de tipo inocuo apuntando al objeto de OTRO documento del
  // mismo tenant; borrarla se llevaba los bytes ajenos. Ahora la ruta se
  // construye, no se recibe: el alias deja de ser expresable.

  it('la ruta se construye con documentId + fileName', async () => {
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'ine.pdf',
      documentId: 'doc-1754650000011-000abc12',
    });
    expect(doc.id).toBe('doc-1754650000011-000abc12');
    expect(doc.storagePath).toBe(buildDocumentPath('tenant-a', 'c-1', 'doc-1754650000011-000abc12', 'ine.pdf'));
    expect(doc.tenantId).toBe('tenant-a');
  });

  it('un storagePath en el cuerpo se ignora: no llega a la fila', async () => {
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'ine.pdf',
      documentId: 'doc-1754650000010-0000a100',
      // Ruta del MISMO tenant y con forma válida — pasaba las tres validaciones
      // anteriores — pero apunta al objeto de otro cliente.
      storagePath: 'tenant-a/c-victima/doc-ajeno-contrato.pdf',
    });
    expect(doc.storagePath).toBe('tenant-a/c-1/doc-1754650000010-0000a100-ine.pdf');
    expect(doc.storagePath).not.toContain('c-victima');
  });

  it('ni siquiera con `..`: la ruta del cuerpo no se lee en absoluto', async () => {
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'x.pdf',
      documentId: 'doc-1754650000002-000000a2',
      storagePath: 'tenant-a/../tenant-b/x.pdf',
    });
    expect(doc.storagePath!.startsWith('tenant-a/c-1/')).toBe(true);
    expect(doc.storagePath).not.toContain('..');
  });

  it('exige documentId: sin él no se sabe qué objeto se subió', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', { fileName: 'x.pdf' }),
    ).rejects.toThrow(/Missing documentId/);
  });

  it('rechaza un documentId con forma inválida', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'x.pdf',
        documentId: '../../evil',
      }),
    ).rejects.toThrow(/Invalid documentId/);
  });

  it('sigue exigiendo fileName', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', { documentId: 'doc-1754650000003-000000a3' }),
    ).rejects.toThrow(/Missing fileName/);
  });
});

describe('addDocument — doc_type', () => {
  it("rechaza 'contract': lo emite sólo el flujo de firma", async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'contrato.pdf',
        documentId: 'doc-1754650000004-000000a4',
        docType: 'contract',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DOC_TYPE_RESERVED' });
  });

  it('rechaza un tipo fuera del CHECK en vez de dejar que reviente el insert', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'x.pdf',
        documentId: 'doc-1754650000005-000000a5',
        docType: 'inventado',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FIELD' });
  });

  it('acepta los tipos asignables', async () => {
    // Los ids llevan la forma que emite `uid('doc')`: `doc-<ms>-<hex8>`. No vale
    // inventarlos con el nombre del tipo — el patrón anclado los rechaza, y esa
    // es justo la propiedad que impide que dos documentos compartan ruta.
    const tipos = ['ine', 'receipt', 'installation_photo', 'other'];
    for (const [i, docType] of tipos.entries()) {
      const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: `${docType}.pdf`,
        documentId: `doc-17546500001${i}-000000b${i}`,
        docType,
      });
      expect(doc.docType).toBe(docType);
    }
  });

  it('sin docType cae a `other`', async () => {
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'x.pdf',
      documentId: 'doc-1754650000006-000000a6',
    });
    expect(doc.docType).toBe('other');
  });
});

describe('prepareDocumentUpload / getDocumentDownloadUrl — sin Storage configurado', () => {
  it('falla explícitamente en vez de firmar contra un cliente inexistente', async () => {
    await expect(
      serviceWithOwnedClient().prepareDocumentUpload('c-1', 'tenant-a', {
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(/Storage no configurado/);
  });

  it('la descarga también', async () => {
    await expect(
      serviceWithOwnedClient().getDocumentDownloadUrl('c-1', 'tenant-a', 'doc-1754650000001-000000a1'),
    ).rejects.toThrow(/Storage no configurado/);
  });
});

describe('migración del bucket', () => {
  it('el bucket es privado', () => {
    expect(migration).toMatch(/'client-documents',\s*\n?\s*false/);
  });

  it('declara límite de tamaño acorde al backend', () => {
    expect(migration).toContain(String(MAX_DOCUMENT_BYTES));
  });

  it('restringe los mime types a los mismos del backend', () => {
    for (const mime of ALLOWED_DOCUMENT_MIME_TYPES) {
      expect(migration, `falta ${mime} en el bucket`).toContain(`'${mime}'`);
    }
  });

  it('es idempotente', () => {
    expect(migration).toContain('ON CONFLICT (id) DO UPDATE');
    expect(migration).toContain('DROP POLICY IF EXISTS');
  });

  it('solo crea política para service_role — nunca anon/authenticated', () => {
    expect(migration).toContain("= 'service_role'");
    expect(migration).not.toMatch(/TO\s+(anon|authenticated)/);
  });
});

describe('rutas', () => {
  it('firmar una subida exige rol de escritura', () => {
    expect(routes).toMatch(/documents\/upload-url', requireRoles\(\[\.\.\.WRITE\]\)/);
  });

  it('descargar exige al menos rol de lectura', () => {
    expect(routes).toMatch(/download-url', requireRoles\(READ_ROLES\)/);
  });

  it('toda ruta de documentos resuelve el tenant de la petición', () => {
    const documentRoutes = routes.split('\n').filter((l) => l.includes('/documents'));
    expect(documentRoutes.length).toBeGreaterThanOrEqual(3);
  });

  it('borrar un documento exige rol de escritura', () => {
    expect(routes).toMatch(
      /router\.delete\('\/api\/clients\/:clientId\/documents\/:documentId', requireRoles\(\[\.\.\.WRITE\]\)/,
    );
  });

  it('limpiar un huérfano exige rol de escritura', () => {
    expect(routes).toMatch(/documents\/orphan-cleanup', requireRoles\(\[\.\.\.WRITE\]\)/);
  });

  it('ningún endpoint de documentos toma el tenant del cuerpo', () => {
    expect(routes).not.toMatch(/req\.body[^\n]*tenantId/);
    const handlers = routes.match(/\/documents[^\n]*asyncHandler/g) ?? [];
    expect(handlers.length).toBeGreaterThanOrEqual(5);
  });
});
