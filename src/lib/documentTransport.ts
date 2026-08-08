// ====================================================================
// El transporte de documentos de la PWA del técnico.
//
// `DocumentUploadControl` recibe el transporte por parámetro precisamente para
// esto: el CRM inyecta `createAuthorizedApi`, que ya tiene la forma de
// `DocumentTransport`, y la PWA inyecta esto — `fetchWithRateLimitBackoff`
// envuelto en la misma forma.
//
// La PWA NO puede usar el cliente del CRM: en campo sí llegan 429, y el backoff
// por endpoint (con cooldown y Retry-After) es lo que evita que un técnico con
// mala señal machaque la API en bucle. Perderlo aquí sería perderlo justo donde
// hace falta.
// ====================================================================

import { fetchWithRateLimitBackoff } from './apiBackoff';
import type { DocumentTransport } from './documentUpload';

const parse = async (res: Response): Promise<unknown> => {
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res.text();
};

/**
 * Mantiene el contrato de error del resto de la app: el mensaje que viene en
 * `error` del backend, no un "Request failed" genérico. La UI del expediente
 * muestra ese texto tal cual.
 */
const failureMessage = (payload: unknown, status: number): string => {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    return String((payload as { error: unknown }).error);
  }
  return `La petición falló (${status}).`;
};

export function createBackoffDocumentTransport(
  getAuthHeaders: () => Promise<Record<string, string>>,
): DocumentTransport {
  const request = async <T>(url: string, method: string, body?: unknown): Promise<T> => {
    const auth = await getAuthHeaders();
    // Un 429 sale por aquí como ApiRateLimitError SIN llegar al `if (!res.ok)`:
    // es el backoff haciendo su trabajo, y así el llamador puede distinguirlo.
    const res = await fetchWithRateLimitBackoff(url, {
      method,
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = await parse(res);
    if (!res.ok) throw new Error(failureMessage(payload, res.status));
    return payload as T;
  };

  return {
    get: <T>(url: string) => request<T>(url, 'GET'),
    post: <T>(url: string, body?: unknown) => request<T>(url, 'POST', body),
    delete: <T>(url: string, body?: unknown) => request<T>(url, 'DELETE', body),
  };
}
