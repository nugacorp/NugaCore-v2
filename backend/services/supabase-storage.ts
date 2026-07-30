// ====================================================================
// Supabase Storage — documentos del expediente de cliente.
//
// El navegador NUNCA habla directamente con Storage, igual que no habla con
// PostgREST. El flujo es:
//
//   1. El front pide una URL de subida al backend.
//   2. El backend valida RBAC + que el cliente pertenezca al tenant y firma
//      una URL de vida corta con `service_role`.
//   3. El navegador sube los bytes a esa URL firmada (no pasan por Express:
//      el body limit es de 100 kB y proxiar archivos no aporta nada).
//   4. El front registra los metadatos con POST /documents, que persiste
//      `storage_path`.
//
// La descarga es simétrica: el backend firma una URL temporal de lectura.
// El bucket es privado, así que sin firma no hay acceso.
// ====================================================================

import { env } from '../config/env';
import { isSupabaseAdminConfigured, supabaseAdmin } from './supabase-admin';

export const CLIENT_DOCUMENTS_BUCKET = 'client-documents';

/** Vida de las URLs firmadas, en segundos. Corta a propósito. */
const UPLOAD_URL_TTL_SECONDS = 120;
const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Mismos límites que declara el bucket en la migración. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export const isStorageConfigured = (): boolean =>
  isSupabaseAdminConfigured && Boolean(supabaseAdmin) && env.SUPABASE_URL.trim() !== '';

const admin = () => {
  if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
  return supabaseAdmin;
};

/**
 * Normaliza el nombre de archivo para que no pueda salirse de su prefijo.
 * Se queda solo con el basename, sustituye lo que no sea alfanumérico/.-_ y
 * recorta. Nunca devuelve cadena vacía (cae a 'archivo').
 */
export const sanitizeFileName = (raw: string): string => {
  const base = String(raw).split(/[/\\]/).pop() || '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 120);
  return cleaned || 'archivo';
};

/**
 * Ruta canónica de un documento: <tenant>/<cliente>/<documento>-<archivo>.
 * El prefijo por tenant hace visible el aislamiento en la propia ruta.
 */
export const buildDocumentPath = (
  tenantId: string,
  clientId: string,
  documentId: string,
  fileName: string,
): string => {
  const safeSegment = (value: string, fallback: string) => {
    const cleaned = String(value).replace(/[^\w.-]+/g, '-').slice(0, 80);
    return cleaned || fallback;
  };
  return [
    safeSegment(tenantId, 'tenant-default'),
    safeSegment(clientId, 'sin-cliente'),
    `${safeSegment(documentId, 'doc')}-${sanitizeFileName(fileName)}`,
  ].join('/');
};

/**
 * ¿La ruta pertenece al tenant indicado? El backend lo comprueba antes de
 * firmar una descarga: sin esto, conocer un `storage_path` ajeno bastaría
 * para pedir su URL.
 */
export const pathBelongsToTenant = (storagePath: string, tenantId: string): boolean => {
  const prefix = String(storagePath).split('/')[0];
  return prefix === String(tenantId).replace(/[^\w.-]+/g, '-').slice(0, 80);
};

export interface SignedUpload {
  storagePath: string;
  uploadUrl: string;
  token: string;
  expiresInSeconds: number;
}

/** Firma una URL de subida para una ruta ya calculada. */
export async function createDocumentUploadUrl(storagePath: string): Promise<SignedUpload> {
  const { data, error } = await admin()
    .storage.from(CLIENT_DOCUMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error) throw error;
  return {
    storagePath,
    uploadUrl: data.signedUrl,
    token: data.token,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
}

/** Firma una URL de lectura temporal. */
export async function createDocumentDownloadUrl(
  storagePath: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  const { data, error } = await admin()
    .storage.from(CLIENT_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, DOWNLOAD_URL_TTL_SECONDS);
  if (error) throw error;
  return { url: data.signedUrl, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
}

/**
 * Borra el objeto. Se usa como compensación cuando el registro de metadatos
 * falla tras una subida: sin esto quedarían huérfanos en el bucket.
 * No lanza — el borrado es best-effort y el llamador ya está en un camino de error.
 */
export async function removeDocumentObject(storagePath: string): Promise<boolean> {
  try {
    const { error } = await admin().storage.from(CLIENT_DOCUMENTS_BUCKET).remove([storagePath]);
    return !error;
  } catch {
    return false;
  }
}
