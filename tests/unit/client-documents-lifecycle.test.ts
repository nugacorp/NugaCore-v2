import { beforeEach, describe, expect, it, vi } from 'vitest';

// ====================================================================
// Baja de documentos y limpieza de huérfanos.
//
// Estos dos caminos son los únicos del dominio que BORRAN bytes, así que lo
// que se prueba aquí no es tanto el camino feliz como las tres veces que hay
// que NO borrar: contrato con archivo, objeto compartido por dos filas, y ruta
// que no pertenece al tenant.
//
// El módulo de Storage se espía porque en modo mock `isStorageConfigured()` es
// false y el servicio ni siquiera intentaría tocar el bucket: sin el espía,
// "no se borró el objeto" pasaría en verde por el motivo equivocado.
//
// LO QUE ESTOS TESTS NO DEMUESTRAN: que el objeto desaparezca del bucket. Aquí
// sólo se observa la DECISIÓN de llamar a `removeDocumentObject` y con qué
// ruta. Que esa llamada borre de verdad exige Supabase real.
// ====================================================================

const storage = vi.hoisted(() => ({
  removeDocumentObject: vi.fn(async () => true),
  isStorageConfigured: vi.fn(() => true),
}));

vi.mock('../../backend/services/supabase-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../backend/services/supabase-storage')>();
  return { ...actual, ...storage };
});

import { buildDocumentPath } from '../../backend/services/supabase-storage';
import { Client360Service } from '../../backend/domains/client-360/service';
import { client360Memory, type ClientDocument } from '../../backend/domains/client-360/memory-store';

/** Servicio con la comprobación de propiedad neutralizada: el guard de cliente
 *  se prueba aparte, con el servicio intacto. */
const service = () => {
  const svc = new Client360Service();
  svc.assertClientOwned = async () => {};
  return svc;
};

const seed = (doc: Partial<ClientDocument> & { id: string }): ClientDocument => {
  const row: ClientDocument = {
    clientId: 'c-1',
    tenantId: 'tenant-a',
    docType: 'other',
    fileName: 'x.pdf',
    createdAt: new Date().toISOString(),
    ...doc,
  };
  client360Memory.documents.unshift(row);
  return row;
};

const docIds = () => client360Memory.documents.map((d) => d.id);

beforeEach(() => {
  client360Memory.documents.length = 0;
  client360Memory.activity.length = 0;
  storage.removeDocumentObject.mockClear();
  storage.isStorageConfigured.mockReturnValue(true);
});

describe('deleteDocument — barreras de tenant', () => {
  it('un documento de otro tenant no existe para éste', async () => {
    seed({ id: 'doc-1', tenantId: 'tenant-b', storagePath: 'tenant-b/c-1/doc-1-x.pdf' });

    await expect(service().deleteDocument('c-1', 'tenant-a', 'doc-1')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
    expect(docIds()).toContain('doc-1');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('un documento inexistente da 404', async () => {
    await expect(service().deleteDocument('c-1', 'tenant-a', 'doc-fantasma')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('no relaja assertClientOwned: sin cliente propio no llega a mirar el documento', async () => {
    seed({ id: 'doc-1', clientId: 'c-ajeno', storagePath: 'tenant-a/c-ajeno/doc-1-x.pdf' });

    // Servicio intacto: el cliente no existe en este tenant.
    await expect(
      new Client360Service().deleteDocument('c-ajeno', 'tenant-a', 'doc-1'),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(docIds()).toContain('doc-1');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('una fila legacy que apunta fuera del tenant se borra, pero el objeto no se toca', async () => {
    // Sólo es alcanzable para filas escritas cuando el backend aceptaba la ruta
    // del cliente. Borrar la fila limpia; borrar el objeto sería cruzar tenants.
    seed({ id: 'doc-1', storagePath: 'tenant-b/c-9/doc-1-robado.pdf' });

    const res = await service().deleteDocument('c-1', 'tenant-a', 'doc-1');

    expect(docIds()).not.toContain('doc-1');
    expect(res.objectRetainedReason).toBe('foreign_tenant_path');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });
});

describe('deleteDocument — el contrato con archivo es inmutable', () => {
  it('409 si doc_type=contract y hay storage_path', async () => {
    seed({
      id: 'doc-contrato',
      docType: 'contract',
      fileName: 'contrato.pdf',
      storagePath: 'tenant-a/c-1/doc-contrato-contrato.pdf',
    });

    await expect(service().deleteDocument('c-1', 'tenant-a', 'doc-contrato')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONTRACT_DOCUMENT_IMMUTABLE',
    });
    expect(docIds()).toContain('doc-contrato');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('una fila fantasma —contract SIN archivo— sí se borra', async () => {
    // Es exactamente la basura que dejó `Client360Panel.tsx:244`, que hardcodea
    // docType 'contract' y persiste sin subir nada. Rechazarla por tipo la
    // volvería indeleble para siempre.
    seed({ id: 'doc-fantasma', docType: 'contract', fileName: 'ine.jpg', storagePath: undefined });

    const res = await service().deleteDocument('c-1', 'tenant-a', 'doc-fantasma');

    expect(docIds()).not.toContain('doc-fantasma');
    expect(res.objectRetainedReason).toBe('no_storage_object');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });
});

describe('deleteDocument — el objeto compartido sobrevive', () => {
  it('si otra fila referencia la misma ruta, borra la fila y deja el objeto', async () => {
    const shared = 'tenant-a/c-1/doc-original-ine.pdf';
    seed({ id: 'doc-original', storagePath: shared });
    seed({ id: 'doc-alias', storagePath: shared });

    const res = await service().deleteDocument('c-1', 'tenant-a', 'doc-alias');

    expect(docIds()).not.toContain('doc-alias');
    expect(docIds()).toContain('doc-original');
    expect(res.objectRetainedReason).toBe('shared_by_other_documents');
    expect(res.objectRemoved).toBe(false);
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('cuenta las filas de cualquier cliente, no sólo las del propio', async () => {
    const shared = 'tenant-a/c-1/doc-1-ine.pdf';
    seed({ id: 'doc-1', storagePath: shared });
    seed({ id: 'doc-vecino', clientId: 'c-2', storagePath: shared });

    const res = await service().deleteDocument('c-1', 'tenant-a', 'doc-1');

    expect(res.objectRetainedReason).toBe('shared_by_other_documents');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });
});

describe('deleteDocument — camino normal', () => {
  it('borra la fila y pide el borrado del objeto con su ruta exacta', async () => {
    const path = buildDocumentPath('tenant-a', 'c-1', 'doc-1', 'ine.pdf');
    seed({ id: 'doc-1', docType: 'ine', fileName: 'ine.pdf', storagePath: path });

    const res = await service().deleteDocument('c-1', 'tenant-a', 'doc-1');

    expect(docIds()).not.toContain('doc-1');
    expect(storage.removeDocumentObject).toHaveBeenCalledWith(path);
    expect(res.objectRemoved).toBe(true);
    expect(res.objectRetainedReason).toBeNull();
  });

  it('la baja queda en el timeline', async () => {
    seed({ id: 'doc-1', fileName: 'ine.pdf', storagePath: 'tenant-a/c-1/doc-1-ine.pdf' });

    await service().deleteDocument('c-1', 'tenant-a', 'doc-1');

    expect(client360Memory.activity.some((a) => a.action === 'document_removed')).toBe(true);
  });

  it('sin Storage configurado borra la fila y no finge haber borrado el objeto', async () => {
    storage.isStorageConfigured.mockReturnValue(false);
    seed({ id: 'doc-1', storagePath: 'tenant-a/c-1/doc-1-x.pdf' });

    const res = await service().deleteDocument('c-1', 'tenant-a', 'doc-1');

    expect(docIds()).not.toContain('doc-1');
    expect(res.objectRetainedReason).toBe('storage_unavailable');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });
});

describe('cleanupOrphanDocumentObject — no acepta rutas, las recalcula', () => {
  it('rechaza un documentId con `../` antes de tocar nada', async () => {
    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
        documentId: '../../tenant-b/c-9/doc',
        fileName: 'x.pdf',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_FIELD' });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('exige documentId y fileName', async () => {
    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', { fileName: 'x.pdf' }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' });
    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', { documentId: 'doc-1' }),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD' });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('no relaja assertClientOwned: un cliente de otro tenant no llega al bucket', async () => {
    await expect(
      new Client360Service().cleanupOrphanDocumentObject('c-ajeno', 'tenant-a', {
        documentId: 'doc-1',
        fileName: 'x.pdf',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('la ruta que borra siempre cae bajo el tenant del solicitante', async () => {
    // El cuerpo no puede desviarla: tenantId y clientId salen de la petición ya
    // autorizada, no del body.
    await service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
      documentId: 'doc-1',
      fileName: '../../tenant-b/robo.pdf',
    });

    const [called] = storage.removeDocumentObject.mock.calls[0] as unknown as [string];
    expect(called.startsWith('tenant-a/c-1/')).toBe(true);
    expect(called).not.toContain('..');
    expect(called).not.toContain('tenant-b');
  });
});

describe('cleanupOrphanDocumentObject — sólo huérfanos de verdad', () => {
  it('rechaza si existe una fila con ese documentId', async () => {
    // Sin esta guardia, orphan-cleanup sería un borrado de documentos encubierto
    // que además saltaría la guardia de contratos del DELETE.
    seed({ id: 'doc-1', storagePath: buildDocumentPath('tenant-a', 'c-1', 'doc-1', 'ine.pdf') });

    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
        documentId: 'doc-1',
        fileName: 'ine.pdf',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_NOT_ORPHAN' });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('rechaza si otra fila referencia la ruta derivada, aunque su id sea otro', async () => {
    seed({ id: 'doc-otro', storagePath: buildDocumentPath('tenant-a', 'c-1', 'doc-1', 'ine.pdf') });

    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
        documentId: 'doc-1',
        fileName: 'ine.pdf',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_NOT_ORPHAN' });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('no puede llegar al PDF de un contrato registrado', async () => {
    seed({
      id: 'doc-contrato',
      docType: 'contract',
      fileName: 'contrato.pdf',
      storagePath: buildDocumentPath('tenant-a', 'c-1', 'doc-contrato', 'contrato.pdf'),
    });

    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
        documentId: 'doc-contrato',
        fileName: 'contrato.pdf',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DOCUMENT_NOT_ORPHAN' });
    expect(docIds()).toContain('doc-contrato');
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });

  it('un huérfano real sí se limpia, con la ruta derivada', async () => {
    const path = buildDocumentPath('tenant-a', 'c-1', 'doc-huerfano', 'ine.pdf');

    const res = await service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
      documentId: 'doc-huerfano',
      fileName: 'ine.pdf',
    });

    expect(storage.removeDocumentObject).toHaveBeenCalledWith(path);
    expect(res).toMatchObject({ ok: true, storagePath: path, removed: true });
    expect(client360Memory.activity.some((a) => a.action === 'document_orphan_cleanup')).toBe(true);
  });

  it('sin Storage configurado falla explícitamente en vez de decir que limpió', async () => {
    storage.isStorageConfigured.mockReturnValue(false);

    await expect(
      service().cleanupOrphanDocumentObject('c-1', 'tenant-a', {
        documentId: 'doc-1',
        fileName: 'x.pdf',
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'STORAGE_UNAVAILABLE' });
    expect(storage.removeDocumentObject).not.toHaveBeenCalled();
  });
});
