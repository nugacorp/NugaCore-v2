type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
}

const defaultHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
};

// --------------------------------------------------------------------
// Inyección de cabeceras de autenticación (opt-in, aditivo).
//
// Por defecto NO inyecta nada (comportamiento idéntico al anterior).
// En Fase 1, el frontend podrá llamar `configureApiClient({ getAuthHeaders })`
// para adjuntar Authorization / x-user-* sin tocar cada call site.
// --------------------------------------------------------------------
type AuthHeaderProvider = () => Record<string, string>;

let authHeaderProvider: AuthHeaderProvider = () => ({});

export function configureApiClient(options: { getAuthHeaders?: AuthHeaderProvider }): void {
  if (options.getAuthHeaders) {
    authHeaderProvider = options.getAuthHeaders;
  }
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...defaultHeaders,
      ...authHeaderProvider(),
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String((payload as { error: string }).error)
      : `Request failed with status ${response.status}`;

    throw new ApiClientError(response.status, message, payload);
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body }),
  put: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PUT', body }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PATCH', body }),
  delete: <T>(url: string, body?: unknown) => request<T>(url, { method: 'DELETE', body }),
};

// --------------------------------------------------------------------
// API autorizada por componente (Fase 4 production-ready).
//
// Los módulos reciben `getAuthHeaders` como prop (puede ser async). Este
// factory devuelve un cliente con las cabeceras de auth inyectadas en cada
// petición, manteniendo el manejo de errores centralizado (ApiClientError
// con el mensaje `error` del backend cuando existe).
// --------------------------------------------------------------------
export type AuthHeadersGetter = () =>
  | Promise<Record<string, string>>
  | Record<string, string>;

export interface AuthorizedApi {
  get: <T>(url: string) => Promise<T>;
  post: <T>(url: string, body?: unknown) => Promise<T>;
  put: <T>(url: string, body?: unknown) => Promise<T>;
  patch: <T>(url: string, body?: unknown) => Promise<T>;
  delete: <T>(url: string, body?: unknown) => Promise<T>;
}

export function createAuthorizedApi(getAuthHeaders: AuthHeadersGetter): AuthorizedApi {
  const withAuth = async <T>(url: string, options: RequestOptions = {}): Promise<T> => {
    const auth = await getAuthHeaders();
    return request<T>(url, { ...options, headers: { ...auth, ...(options.headers || {}) } });
  };
  return {
    get: <T>(url: string) => withAuth<T>(url),
    post: <T>(url: string, body?: unknown) => withAuth<T>(url, { method: 'POST', body }),
    put: <T>(url: string, body?: unknown) => withAuth<T>(url, { method: 'PUT', body }),
    patch: <T>(url: string, body?: unknown) => withAuth<T>(url, { method: 'PATCH', body }),
    delete: <T>(url: string, body?: unknown) => withAuth<T>(url, { method: 'DELETE', body }),
  };
}
