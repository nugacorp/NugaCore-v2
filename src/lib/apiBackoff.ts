// ====================================================================
// Frontend polling hygiene: HTTP 429 handling with endpoint cooldown.
//
// - Respeta Retry-After cuando existe.
// - Aplica backoff local mínimo/progresivo.
// - Evita reintentos inmediatos infinitos en loops de polling.
// ====================================================================

export interface ApiBackoffOptions {
  key?: string;
  minBackoffMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

interface EndpointBackoffState {
  retryUntilMs: number;
  failures: number;
}

const endpointBackoff = new Map<string, EndpointBackoffState>();

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

export const parseRetryAfterMs = (headerValue: string | null, nowMs = Date.now()): number | null => {
  if (!headerValue) return null;

  const raw = headerValue.trim();
  if (raw === '') return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const absoluteMs = Date.parse(raw);
  if (Number.isFinite(absoluteMs)) {
    return Math.max(0, absoluteMs - nowMs);
  }

  return null;
};

export class ApiRateLimitError extends Error {
  readonly status = 429;

  constructor(
    public readonly endpointKey: string,
    public readonly retryAfterMs: number,
    public readonly retryAtMs: number,
    public readonly fromCooldown: boolean,
  ) {
    super(`Rate limited for ${endpointKey}. Retry in ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'ApiRateLimitError';
  }
}

export const isApiRateLimitError = (error: unknown): error is ApiRateLimitError =>
  error instanceof ApiRateLimitError;

export const getApiBackoffCooldownMs = (endpointKey: string, nowMs = Date.now()): number => {
  const state = endpointBackoff.get(endpointKey);
  if (!state) return 0;
  return Math.max(0, state.retryUntilMs - nowMs);
};

export const resetApiBackoffState = (): void => {
  endpointBackoff.clear();
};

export async function fetchWithRateLimitBackoff(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: ApiBackoffOptions = {},
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const requestUrl = toRequestUrl(input);
  const endpointKey = options.key ?? `${method} ${requestUrl}`;

  const minBackoffMs = options.minBackoffMs ?? 5000;
  const baseBackoffMs = options.baseBackoffMs ?? 5000;
  const maxBackoffMs = options.maxBackoffMs ?? 120000;

  const nowMs = Date.now();
  const previousState = endpointBackoff.get(endpointKey);
  if (previousState && previousState.retryUntilMs > nowMs) {
    throw new ApiRateLimitError(
      endpointKey,
      previousState.retryUntilMs - nowMs,
      previousState.retryUntilMs,
      true,
    );
  }

  const response = await fetch(input, init);

  if (response.status === 429) {
    const retryAfterHeaderMs = parseRetryAfterMs(response.headers.get('retry-after'), nowMs);
    const failures = (previousState?.failures ?? 0) + 1;
    const exponentialBackoffMs = baseBackoffMs * 2 ** Math.max(0, failures - 1);
    const candidateMs = Math.max(retryAfterHeaderMs ?? 0, exponentialBackoffMs, minBackoffMs);
    const retryAfterMs = clamp(candidateMs, minBackoffMs, maxBackoffMs);
    const retryAtMs = nowMs + retryAfterMs;

    endpointBackoff.set(endpointKey, {
      retryUntilMs: retryAtMs,
      failures,
    });

    throw new ApiRateLimitError(endpointKey, retryAfterMs, retryAtMs, false);
  }

  if (response.ok) {
    endpointBackoff.delete(endpointKey);
  }

  return response;
}
