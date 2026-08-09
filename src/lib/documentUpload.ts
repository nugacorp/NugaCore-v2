// ====================================================================
// Subida de documentos del expediente — lógica compartida.
//
// Aquí vive TODO lo que no es pintar: validación, compresión, los tres pasos
// del flujo y la compensación del huérfano. El componente de React encima es un
// cascarón, y la PWA del técnico reutiliza este módulo tal cual.
//
// El flujo (el backend ya lo implementa, ver backend/services/supabase-storage.ts):
//
//   1. POST /documents/upload-url  → el backend firma (RBAC + tenant)
//   2. PUT a la URL firmada        → los bytes NO pasan por Express (body limit 100 kB)
//   3. POST /documents             → el backend DERIVA la ruta y registra
//
// Dos cosas que este módulo no hace a propósito:
//
// - No importa `apiClient` ni `fetchWithRateLimitBackoff`. Recibe el transporte
//   por parámetro, porque el CRM va por `createAuthorizedApi` y la PWA del
//   técnico por `fetchWithRateLimitBackoff` — que existe porque en campo sí
//   llegan 429. Importar uno de los dos le quitaría al otro lo que necesita.
// - No encola nada sin conexión. El control se deshabilita y se dice por qué:
//   que el técnico vea que no puede subir es mejor que creer que subió.
// ====================================================================

/** Espejo de ALLOWED_DOCUMENT_MIME_TYPES en el backend y del CHECK del bucket. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/** Espejo de MAX_DOCUMENT_BYTES: el bucket rechaza a partir de aquí. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Canvas a ~1600 px, JPEG q0.8. Una foto de móvil baja de 3-5 MB a 200-400 KB,
 * de sobra para leer una INE. No es por la cola offline —descartada— sino
 * porque en 4G rural una subida de 5 MB simplemente falla.
 */
export const IMAGE_COMPRESSION = { maxDimension: 1600, quality: 0.8 } as const;

/** Los tipos que la API acepta; `contract` lo emite sólo el flujo de firma. */
export const ASSIGNABLE_DOC_TYPES = ['ine', 'receipt', 'installation_photo', 'other'] as const;
export type AssignableDocType = (typeof ASSIGNABLE_DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<string, string> = {
  ine: 'INE',
  receipt: 'Comprobante',
  installation_photo: 'Foto de instalación',
  contract: 'Contrato',
  other: 'Otro',
};

/**
 * Lo mínimo que este módulo necesita de un archivo. `File` del navegador lo
 * cumple; declararlo así permite ejercitar el flujo entero sin DOM.
 */
export interface UploadableFile {
  name: string;
  type: string;
  size: number;
}

/**
 * El transporte que el llamador inyecta. `AuthorizedApi` del CRM ya tiene esta
 * forma; la PWA envuelve `fetchWithRateLimitBackoff` para conservar su backoff.
 */
export interface DocumentTransport {
  get: <T>(url: string) => Promise<T>;
  post: <T>(url: string, body?: unknown) => Promise<T>;
  delete: <T>(url: string, body?: unknown) => Promise<T>;
}

/** Recodifica una imagen. En el navegador lo hace un canvas; en test, un doble. */
export type ImageEncoder = (
  file: UploadableFile,
  options: { maxDimension: number; quality: number },
) => Promise<UploadableFile>;

/** Sube los bytes a la URL firmada. Va directo al bucket, no a nuestra API. */
export type ObjectPutter = (uploadUrl: string, file: UploadableFile) => Promise<void>;

export type UploadFailureCode =
  | 'OFFLINE'
  | 'INVALID_MIME_TYPE'
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'SIGN_FAILED'
  | 'PUT_FAILED'
  | 'REGISTER_FAILED';

export class DocumentUploadError extends Error {
  constructor(
    public readonly code: UploadFailureCode,
    message: string,
    /** True cuando quedó un objeto en el bucket que no se pudo compensar. */
    public readonly orphanLeft = false,
  ) {
    super(message);
    this.name = 'DocumentUploadError';
  }
}

export const isCompressibleImage = (mimeType: string): boolean =>
  mimeType === 'image/jpeg' || mimeType === 'image/png' || mimeType === 'image/webp';

export type FileCheck = { ok: true } | { ok: false; code: UploadFailureCode; message: string };

/**
 * Lo que se sabe SIN mirar el tamaño, y por tanto puede decidirse antes de
 * comprimir: el formato y que el archivo no venga vacío. Comprimir un tipo que
 * el bucket no acepta es trabajo tirado, y firmarlo, una firma tirada.
 */
export const validateDocumentType = (file: UploadableFile): FileCheck => {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number])) {
    return {
      ok: false,
      code: 'INVALID_MIME_TYPE',
      message: 'Formato no admitido. Sube un PDF o una imagen JPG, PNG o WebP.',
    };
  }
  if (file.size <= 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'El archivo está vacío.' };
  }
  return { ok: true };
};

/**
 * El tamaño se juzga DESPUÉS de comprimir, sobre lo que de verdad se va a
 * subir.
 *
 * Antes corría delante, y eso rechazaba con "supera el máximo de 10 MB" un
 * JPEG de 12 MB que el canvas habría dejado en 300 KB — un móvil de 48 MP en
 * HDR, o sea el equipo del técnico en campo, sin ninguna salida ofrecida. El
 * argumento de "no gastar una firma" no aplicaba: la firma no se pide hasta
 * después de comprimir.
 */
export const validateDocumentSize = (file: UploadableFile): FileCheck => {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `El archivo supera el máximo de ${Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB, incluso comprimido.`,
    };
  }
  return { ok: true };
};

/** Ambas comprobaciones. Es lo que se aplica al archivo ya listo para subir. */
export const validateDocumentFile = (file: UploadableFile): FileCheck => {
  const type = validateDocumentType(file);
  return type.ok ? validateDocumentSize(file) : type;
};

/**
 * Comprime si —y sólo si— es una imagen. Los PDF se suben tal cual: pasarlos por
 * un canvas los convertiría en una foto de la primera página.
 */
export const compressIfImage = async (
  file: UploadableFile,
  encode: ImageEncoder | undefined,
): Promise<UploadableFile> => {
  if (!encode || !isCompressibleImage(file.type)) return file;
  try {
    const compressed = await encode(file, IMAGE_COMPRESSION);
    // Si recodificar no ayudó (imagen ya pequeña), quedarse con el original.
    return compressed.size > 0 && compressed.size < file.size ? compressed : file;
  } catch {
    // Comprimir es una optimización: que falle no debe impedir la subida.
    return file;
  }
};

/**
 * Sustituye el nombre base conservando la extensión.
 *
 * INE frente y reverso son el MISMO `doc_type` ('ine') y se distinguen por el
 * nombre del archivo: cambiar el CHECK de la tabla obligaría a una migración
 * para algo que la ruta del objeto ya expresa. Y el nombre que trae la cámara
 * (`IMG_20260808_112233.jpg`) no distingue nada.
 */
export const composeFileName = (prefix: string | undefined, originalName: string): string => {
  const clean = String(prefix ?? '').trim();
  if (!clean) return originalName;
  const match = /\.[^./\\]+$/.exec(originalName);
  return `${clean}${match ? match[0] : ''}`;
};

export interface UploadedDocument {
  id: string;
  fileName: string;
  docType: string;
}

interface SignedUploadResponse {
  documentId: string;
  uploadUrl: string;
  // `storagePath` también viene en la respuesta y NO se declara a propósito: el
  // cliente no debe usar la ruta para nada. La deriva el backend en los dos
  // pasos; tenerla a mano aquí sólo invitaría a volver a mandarla.
}

/**
 * Los tres pasos, con compensación. Si el registro falla tras subir los bytes,
 * pide a `orphan-cleanup` que borre el objeto: sin eso quedaría basura en el
 * bucket que nadie sabe que existe.
 */
export async function uploadClientDocument(params: {
  clientId: string;
  docType: AssignableDocType | string;
  file: UploadableFile;
  transport: DocumentTransport;
  putObject: ObjectPutter;
  encodeImage?: ImageEncoder;
  isOnline?: boolean;
  /** Renombra el archivo: así `ine-frente` y `ine-reverso` se distinguen. */
  fileNamePrefix?: string;
}): Promise<UploadedDocument> {
  const { clientId, docType, transport, putObject, encodeImage } = params;

  if (params.isOnline === false) {
    throw new DocumentUploadError(
      'OFFLINE',
      'Sin conexión: no se puede subir. Vuelve a intentarlo cuando tengas señal.',
    );
  }

  // Sólo el formato: el tamaño todavía no significa nada, porque comprimir es
  // precisamente lo que puede meterlo dentro del límite.
  const typeCheck = validateDocumentType(params.file);
  if (!typeCheck.ok) throw new DocumentUploadError(typeCheck.code, typeCheck.message);

  const file = await compressIfImage(params.file, encodeImage);

  // Ahora sí, sobre lo que de verdad se va a subir. Se revalida también el tipo
  // porque comprimir lo cambia (PNG → JPEG).
  const finalCheck = validateDocumentFile(file);
  if (!finalCheck.ok) throw new DocumentUploadError(finalCheck.code, finalCheck.message);

  // Se calcula UNA vez y se usa en los tres sitios. El backend deriva la ruta
  // de (documentId, fileName) tanto al firmar como al registrar: mandar nombres
  // distintos dejaría la fila apuntando a un objeto que no existe.
  // El File no se renombra —eso rompería el Blob del PUT— y no hace falta: la
  // ruta del objeto la fija la URL firmada, no el nombre local.
  const fileName = composeFileName(params.fileNamePrefix, file.name);

  let signed: SignedUploadResponse;
  try {
    signed = await transport.post<SignedUploadResponse>(
      `/api/clients/${clientId}/documents/upload-url`,
      { fileName, mimeType: file.type, sizeBytes: file.size },
    );
  } catch (err) {
    throw new DocumentUploadError('SIGN_FAILED', messageOf(err, 'No se pudo preparar la subida.'));
  }

  try {
    await putObject(signed.uploadUrl, file);
  } catch (err) {
    // Aún no hay objeto que compensar: la firma caduca sola.
    throw new DocumentUploadError('PUT_FAILED', messageOf(err, 'No se pudo subir el archivo.'));
  }

  try {
    // `fileName` DEBE ser el mismo que se mandó al firmar: el backend deriva la
    // ruta de (documentId, fileName) en los dos pasos, así que un nombre
    // distinto aquí registraría la fila sobre un objeto que no existe.
    return await transport.post<UploadedDocument>(`/api/clients/${clientId}/documents`, {
      documentId: signed.documentId,
      fileName,
      docType,
      mimeType: file.type,
    });
  } catch (err) {
    const orphanLeft = !(await tryCleanupOrphan(transport, clientId, signed.documentId, fileName));
    throw new DocumentUploadError(
      'REGISTER_FAILED',
      messageOf(err, 'El archivo se subió pero no se pudo registrar.'),
      orphanLeft,
    );
  }
}

/** Best-effort: si esto también falla, queda basura en el bucket, no corrupción. */
const tryCleanupOrphan = async (
  transport: DocumentTransport,
  clientId: string,
  documentId: string,
  fileName: string,
): Promise<boolean> => {
  try {
    await transport.post(`/api/clients/${clientId}/documents/orphan-cleanup`, {
      documentId,
      fileName,
    });
    return true;
  } catch {
    return false;
  }
};

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

// ── Lectura del expediente ──────────────────────────────────────────

export interface ExpedienteDocument {
  id: string;
  docType: string;
  fileName: string;
  createdAt: string;
  /** Ausente en las filas que dejó la UI anterior: fila sin archivo. */
  storagePath?: string;
  mimeType?: string;
}

/** Una fila sin objeto no se oculta: se marca. Esconderla taparía el rastro. */
export const hasStoredFile = (doc: ExpedienteDocument): boolean => Boolean(doc.storagePath);

/**
 * El mismo criterio que la guardia del backend, y por el mismo motivo: el PDF
 * de un contrato es la única prueba de lo que se firmó, así que se anula, nunca
 * se borra. `DELETE` responde 409 CONTRACT_DOCUMENT_IMMUTABLE, y ofrecer un
 * botón que siempre falla es peor que no ofrecerlo.
 *
 * La fila fantasma —`contract` SIN archivo— sí se borra: es justo la basura que
 * este trabajo viene a limpiar. El matiz es el mismo a los dos lados.
 */
export const isDeletableDocument = (doc: ExpedienteDocument): boolean =>
  !(doc.docType === 'contract' && hasStoredFile(doc));

/** Conteos por tipo para el sidebar del CRM, que no ve el estado del panel. */
export const countDocumentsByType = (documents: ExpedienteDocument[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const doc of documents) {
    counts[doc.docType] = (counts[doc.docType] ?? 0) + 1;
  }
  return counts;
};

/** Cuántos tienen archivo de verdad — el conteo honesto para el sidebar. */
export const countDocumentsWithFile = (documents: ExpedienteDocument[]): number =>
  documents.filter(hasStoredFile).length;

/**
 * El `DELETE` puede quitar la fila y dejar el objeto. Traducirlo importa: si no,
 * el usuario ve "borrado" y el archivo sigue ahí.
 */
export const describeDeletion = (result: {
  objectRemoved?: boolean;
  objectRetainedReason?: string | null;
}): string => {
  if (result.objectRemoved) return 'Documento y archivo eliminados.';
  switch (result.objectRetainedReason) {
    case 'no_storage_object':
      return 'Registro eliminado. No tenía archivo asociado.';
    case 'shared_by_other_documents':
      return 'Registro eliminado. El archivo se conserva porque otro documento lo usa.';
    case 'foreign_tenant_path':
      return 'Registro eliminado. El archivo no se tocó: no pertenece a este WISP.';
    case 'storage_unavailable':
      return 'Registro eliminado, pero el almacenamiento no está configurado y el archivo sigue ahí.';
    default:
      return 'Registro eliminado.';
  }
};
