import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRateLimitError,
  fetchWithRateLimitBackoff,
  getApiBackoffCooldownMs,
  isApiRateLimitError,
  parseRetryAfterMs,
  resetApiBackoffState,
} from '../../src/lib/apiBackoff';

const originalFetch = globalThis.fetch;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('apiBackoff', () => {
  beforeEach(() => {
    resetApiBackoffState();
  });

  afterEach(() => {
    resetApiBackoffState();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('parseRetryAfterMs supports delta-seconds', () => {
    expect(parseRetryAfterMs('5', 1000)).toBe(5000);
  });

  it('parseRetryAfterMs supports HTTP-date', () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const retryDate = new Date(now + 7000).toUTCString();

    expect(parseRetryAfterMs(retryDate, now)).toBe(7000);
  });

  it('records cooldown on 429 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('', { status: 429, headers: { 'retry-after': '1' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchWithRateLimitBackoff('/api/demo', undefined, {
        key: 'GET /api/demo',
        minBackoffMs: 500,
        baseBackoffMs: 500,
        maxBackoffMs: 5000,
      }),
    ).rejects.toBeInstanceOf(ApiRateLimitError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getApiBackoffCooldownMs('GET /api/demo')).toBeGreaterThan(0);
  });

  it('short-circuits repeated calls during cooldown without extra fetch', async () => {
    const key = 'GET /api/alerts';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('', { status: 429, headers: { 'retry-after': '2' } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let firstError: unknown;
    try {
      await fetchWithRateLimitBackoff('/api/alerts', undefined, {
        key,
        minBackoffMs: 2000,
        baseBackoffMs: 2000,
        maxBackoffMs: 2000,
      });
    } catch (error) {
      firstError = error;
    }

    let secondError: unknown;
    try {
      await fetchWithRateLimitBackoff('/api/alerts', undefined, {
        key,
        minBackoffMs: 2000,
        baseBackoffMs: 2000,
        maxBackoffMs: 2000,
      });
    } catch (error) {
      secondError = error;
    }

    expect(isApiRateLimitError(firstError)).toBe(true);
    expect(isApiRateLimitError(secondError)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    if (isApiRateLimitError(firstError)) {
      expect(firstError.fromCooldown).toBe(false);
    }
    if (isApiRateLimitError(secondError)) {
      expect(secondError.fromCooldown).toBe(true);
    }
  });

  it('clears cooldown after a successful response', async () => {
    const key = 'GET /api/dashboard-stats';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchWithRateLimitBackoff('/api/dashboard-stats', undefined, {
        key,
        minBackoffMs: 20,
        baseBackoffMs: 20,
        maxBackoffMs: 20,
      }),
    ).rejects.toBeInstanceOf(ApiRateLimitError);

    await wait(30);

    const response = await fetchWithRateLimitBackoff('/api/dashboard-stats', undefined, {
      key,
      minBackoffMs: 20,
      baseBackoffMs: 20,
      maxBackoffMs: 20,
    });

    expect(response.status).toBe(200);
    expect(getApiBackoffCooldownMs(key)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
