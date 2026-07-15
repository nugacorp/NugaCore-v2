import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RELOAD_KEY,
  clearChunkReloadFlag,
  importWithChunkRetry,
  isChunkLoadError,
} from '../../src/lib/lazyWithRetry';

const memoryStore = new Map<string, string>();

beforeEach(() => {
  memoryStore.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => memoryStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memoryStore.set(k, String(v));
    },
    removeItem: (k: string) => {
      memoryStore.delete(k);
    },
    clear: () => memoryStore.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  memoryStore.clear();
});

describe('isChunkLoadError', () => {
  it('detecta el error típico de chunk ausente tras deploy', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://x/assets/NocReadOnlyModule-old.js',
        ),
      ),
    ).toBe(true);
  });

  it('no captura errores de app normales', () => {
    expect(isChunkLoadError(new Error('Network offline'))).toBe(false);
  });
});

describe('importWithChunkRetry', () => {
  it('limpia el flag tras import exitoso', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    const Comp = () => null;
    await importWithChunkRetry(async () => ({ default: Comp }));
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('recarga una vez cuando falta el chunk', async () => {
    const reload = vi.fn();
    const Comp = () => null;
    const result = await importWithChunkRetry(
      async () => {
        throw new TypeError('Failed to fetch dynamically imported module: https://x/a.js');
      },
      reload,
      'https://example.test/noc',
    );

    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBe('1');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(String(reload.mock.calls[0][0])).toMatch(/^https:\/\/example\.test\/noc\?_nc=\d+$/);
    expect(result.default).toBeTypeOf('function');
    expect(Comp).toBeTruthy();
  });

  it('no entra en bucle: en el segundo fallo relanza', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    const reload = vi.fn();
    const err = new TypeError('Failed to fetch dynamically imported module: https://x/a.js');

    await expect(
      importWithChunkRetry(
        async () => {
          throw err;
        },
        reload,
        'https://example.test/',
      ),
    ).rejects.toBe(err);

    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('clearChunkReloadFlag remueve la clave', () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    clearChunkReloadFlag();
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });
});
