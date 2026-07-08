import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ModuleImporter<T extends ComponentType<unknown>> = () => Promise<{ default: T }>;

const CHUNK_RELOAD_KEY = 'nugacore.chunk-reload';

const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(message);
};

/**
 * React.lazy con reintento tras deploy: si el chunk JS cambió de hash (p. ej. por
 * service worker o caché del navegador), recarga una vez y vuelve a importar.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: ModuleImporter<T>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importer();
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      const reloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
      if (!reloaded) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        return { default: (() => null) as unknown as T };
      }
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      throw error;
    }
  });
}
