import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Expediente en la UI — verificación string-based (patrón del repo).
//
// Los tests corren en `environment: 'node'`, sin jsdom: no se puede renderizar.
// Lo que se comprueba aquí son contratos estructurales del source —qué importa
// cada archivo, tras qué cap se esconde cada control—, no comportamiento. El
// comportamiento vive en `documentUpload.ts` y se prueba de verdad en
// `document-upload.test.ts`.
// ====================================================================

const control = readFileSync('src/components/DocumentUploadControl.tsx', 'utf8');
const panel = readFileSync('src/components/Client360Panel.tsx', 'utf8');
const crm = readFileSync('src/components/CrmModule.tsx', 'utf8');

describe('la frontera del componente compartido', () => {
  it('NO importa ningún cliente HTTP concreto', () => {
    // Ésta es la razón de ser del parámetro `transport`: el CRM va por un
    // cliente autorizado y la PWA del técnico por el suyo con backoff, que
    // existe porque en campo sí llegan 429. Importar cualquiera de los dos le
    // quitaría al otro lo que necesita.
    //
    // Se mira la lista de imports y las llamadas, no la mera aparición del
    // nombre: los comentarios de este repo citan ambos transportes al explicar
    // por qué se inyectan.
    const imports = control.split('\n').filter((l) => l.startsWith('import')).join('\n');
    expect(imports).not.toContain('apiClient');
    expect(imports).not.toContain('apiBackoff');
    expect(control).not.toMatch(/createAuthorizedApi\(/);
    expect(control).not.toMatch(/fetchWithRateLimitBackoff\(/);
  });

  it('recibe el transporte por props', () => {
    expect(control).toMatch(/transport:\s*DocumentTransport/);
    expect(control).toContain('transport,');
  });

  it('E3 puede parametrizar tipos, ids y transporte sin tocar el archivo', () => {
    for (const prop of ['docTypes', 'idPrefix', 'defaultDocType', 'putObject', 'disabled']) {
      expect(control, `falta la prop ${prop}`).toContain(prop);
    }
  });

  it('la lógica no vive aquí: delega en documentUpload', () => {
    expect(control).toContain("from '../lib/documentUpload'");
    expect(control).toContain('uploadClientDocument');
  });

  it('el PUT de bytes va directo al bucket, no por nuestra API', () => {
    expect(control).toMatch(/method:\s*'PUT'/);
    expect(control).toContain('uploadUrl');
  });
});

describe('sin conexión', () => {
  it('el control se deshabilita y lo dice, sin encolar nada', () => {
    expect(control).toContain('useOnlineStatus');
    expect(control).toMatch(/blocked\s*=\s*disabled \|\| !online \|\| uploading/);
    expect(control).toContain('No se guarda nada en cola.');
  });

  it('escucha los dos eventos del navegador', () => {
    expect(control).toContain("addEventListener('online'");
    expect(control).toContain("addEventListener('offline'");
  });

  it('el selector y el botón quedan deshabilitados', () => {
    const disabledCount = (control.match(/disabled=\{blocked\}/g) ?? []).length;
    expect(disabledCount).toBeGreaterThanOrEqual(2);
  });
});

describe('el MIME se acota en el propio input', () => {
  it('accept sale de la lista compartida, no de una cadena suelta', () => {
    expect(control).toContain('accept={ALLOWED_DOCUMENT_MIME_TYPES.join(\',\')}');
  });
});

describe('Client360Panel — el flujo real sustituye al que creaba filas vacías', () => {
  it('ya no hace el POST directo que persistía sin archivo', () => {
    // Era `api.post('/api/clients/:id/documents', { fileName, docType: 'contract' })`:
    // el productor de todas las filas fantasma del expediente.
    expect(panel).not.toContain("docType: 'contract'");
    expect(panel).not.toContain('Nombre archivo (metadato)');
  });

  it('monta el control compartido y le pasa su propio transporte', () => {
    expect(panel).toContain('<DocumentUploadControl');
    expect(panel).toContain('transport={documentTransport}');
    expect(panel).toContain('createAuthorizedApi(getAuthHeaders)');
  });

  it('recarga el expediente al terminar una subida', () => {
    expect(panel).toContain('onUploaded={() => loadExpediente()}');
  });

  it('una fila sin archivo se marca y NO ofrece descarga', () => {
    // Ofrecer descarga daría un 404 NO_STORAGE_OBJECT sin explicación.
    expect(panel).toContain('{!hasStoredFile(d) && (');
    expect(panel).toContain('sin archivo');
    expect(panel).toContain('{hasStoredFile(d) && (');
    expect(panel).toContain('client360-document-download-');
  });

  it('la descarga pasa por una URL firmada, no por una ruta directa', () => {
    expect(panel).toContain('/download-url');
    expect(panel).not.toMatch(/storage\/v1\/object\/public/);
  });

  it('traduce lo que el DELETE decidió sobre el archivo', () => {
    // El backend puede quitar la fila y dejar el objeto; decir "eliminado" a
    // secas haría creer que el archivo se fue.
    expect(panel).toContain('describeDeletion(result)');
    expect(panel).toContain('client360-document-notice');
  });
});

describe('el gate de UI refleja el WRITE del backend', () => {
  it('los documentos van tras manageDocuments, no tras editClient', () => {
    expect(panel).toContain('caps.manageDocuments && (');
  });

  it('el bloque de subida y el de borrado usan la cap nueva', () => {
    const usos = (panel.match(/caps\.manageDocuments/g) ?? []).length;
    expect(usos).toBeGreaterThanOrEqual(2);
  });
});

describe('CrmModule — conteos reales en el sidebar', () => {
  it('el placeholder escrito a mano desapareció del markup', () => {
    // Se mira el JSX renderizado, no el texto suelto: el comentario que explica
    // qué se sustituyó lo cita.
    expect(crm).not.toMatch(/>\s*2 Documentos\s*</);
    expect(crm).toContain("plural(identidad, 'Documento', 'Documentos')");
  });

  it('cuenta a partir de los documentos que trae del backend', () => {
    expect(crm).toContain('countDocumentsByType(sidebarDocuments)');
    expect(crm).toContain('countDocumentsWithFile(sidebarDocuments)');
  });

  it('el sidebar hace su propio fetch: no ve el estado del panel', () => {
    // El expediente vive en estado local de `Client360Panel`, y el sidebar se
    // abre sin abrir el panel.
    expect(crm).toMatch(/\/api\/clients\/\$\{customerId\}\/documents/);
    expect(crm).toContain('setSidebarDocuments');
  });

  it('separa los registros sin archivo en vez de sumarlos al total', () => {
    expect(crm).toContain('crm-expediente-sin-archivo');
  });
});
