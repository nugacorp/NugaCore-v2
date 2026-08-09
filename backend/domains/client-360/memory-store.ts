import { randomBytes } from 'node:crypto';

export interface ClientTag {
  id: string;
  clientId: string;
  tenantId?: string;
  label: string;
  color: string;
  createdAt: string;
}

export interface AlternateContact {
  id: string;
  clientId: string;
  tenantId?: string;
  name?: string;
  phone?: string;
  email?: string;
  channel: 'whatsapp' | 'sms' | 'email' | 'phone';
  isPrimary: boolean;
  createdAt: string;
}

export interface ClientDocument {
  id: string;
  clientId: string;
  tenantId?: string;
  docType: 'ine' | 'contract' | 'receipt' | 'installation_photo' | 'other';
  fileName: string;
  storagePath?: string;
  mimeType?: string;
  uploadedBy?: string;
  createdAt: string;
}

export interface ActivityLogEntry {
  id: string;
  clientId: string;
  tenantId?: string;
  actorId?: string;
  actorRole?: string;
  action: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  createdAt: string;
}

export const client360Memory = {
  tags: [] as ClientTag[],
  contacts: [] as AlternateContact[],
  documents: [] as ClientDocument[],
  activity: [] as ActivityLogEntry[],
};

/**
 * Id único con sufijo aleatorio. La marca de tiempo sola NO basta: dos llamadas
 * dentro del mismo milisegundo devolvían el MISMO id, y `documentId` gobierna la
 * ruta del objeto en Storage (`buildDocumentPath`). Dos subidas simultáneas
 * compartían ruta: la segunda sobrescribía los bytes de la primera y el borrado
 * de una se llevaba el archivo de la otra.
 *
 * El repo ya aplicaba este patrón donde se generan ids en ráfaga —`inventory`,
 * `commercial`, y el id de timeline en `customers/repository.ts`—; aquí faltaba.
 */
export const uid = (p: string) => `${p}-${Date.now()}-${randomBytes(4).toString('hex')}`;
export const stamp = () => new Date().toISOString();

/**
 * La forma EXACTA que `uid('doc')` emite. Va aquí, pegado a `uid`, porque son
 * un par: cambiar uno sin el otro rompe la unicidad de la ruta del objeto.
 *
 * No es cosmético. `buildDocumentPath` compone el tercer segmento como
 * `${documentId}-${sanitizeFileName(fileName)}`, y `-` es legal dentro de
 * `/^[\w-]{1,64}$/`, así que con la validación laxa el id absorbía el prefijo
 * del nombre y DOS documentos distintos producían la MISMA ruta:
 *
 *   doc-1754650000000-a1b2c3d4      + ine-frente.jpg
 *   doc-1754650000000-a1b2c3d4-ine  + frente.jpg
 *   → tenant-a/cli-1/doc-1754650000000-a1b2c3d4-ine-frente.jpg   (la misma)
 *
 * Con el hex de longitud fija anclado por `$`, ningún id válido puede ser
 * prefijo de otro seguido de `-`: tras el último guión hay exactamente 8
 * dígitos hex y fin, y `\d+` no admite ni letras ni guiones. La ruta vuelve a
 * ser inyectiva, que es lo que el resto del diseño da por supuesto.
 */
export const DOCUMENT_ID_PATTERN = /^doc-\d+-[0-9a-f]{8}$/;

/** ¿Lo emitió `prepareDocumentUpload`? Es el único emisor legítimo. */
export const isEmittedDocumentId = (value: string): boolean =>
  DOCUMENT_ID_PATTERN.test(value);

/** Legacy rows without stamp belong to tenant-default. */
export const matchesTenant = (
  recordTenantId: string | undefined,
  tenantId: string,
): boolean => (recordTenantId || 'tenant-default') === tenantId;
