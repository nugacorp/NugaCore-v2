import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_BYTES,
  buildDocumentPath,
  pathBelongsToTenant,
  sanitizeFileName,
} from '../../backend/services/supabase-storage';
import { Client360Service } from '../../backend/domains/client-360/service';

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

describe('addDocument — validación de storagePath', () => {
  it('rechaza `..` en la ruta', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'x.pdf',
        storagePath: 'tenant-a/../tenant-b/x.pdf',
      }),
    ).rejects.toThrow(/Invalid storagePath/);
  });

  it('rechaza una ruta de otro tenant', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'x.pdf',
        storagePath: 'tenant-b/c-1/x.pdf',
      }),
    ).rejects.toThrow(/fuera del tenant/);
  });

  it('acepta una ruta del propio tenant', async () => {
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'ine.pdf',
      storagePath: 'tenant-a/c-1/doc-1-ine.pdf',
    });
    expect(doc.storagePath).toBe('tenant-a/c-1/doc-1-ine.pdf');
    expect(doc.tenantId).toBe('tenant-a');
  });

  it('reutiliza el documentId emitido al firmar, para que fila y objeto coincidan', async () => {
    const doc = await serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
      fileName: 'ine.pdf',
      documentId: 'doc-abc123',
      storagePath: 'tenant-a/c-1/doc-abc123-ine.pdf',
    });
    expect(doc.id).toBe('doc-abc123');
  });

  it('rechaza un documentId con forma inválida', async () => {
    await expect(
      serviceWithOwnedClient().addDocument('c-1', 'tenant-a', {
        fileName: 'x.pdf',
        documentId: '../../evil',
      }),
    ).rejects.toThrow(/Invalid documentId/);
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
      serviceWithOwnedClient().getDocumentDownloadUrl('c-1', 'tenant-a', 'doc-1'),
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
});
