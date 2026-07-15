import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type ModuleImporter<T extends ComponentType<unknown>> = () => Promise<{ default: T }>;

export const CHUNK_RELOAD_KEY = 'nugacore.chunk-reload';

export const isChunkLoadError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
};

/** Limpia el flag tras un import OK (permite reintento en el próximo deploy). */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* private mode / no DOM */
  }
}

/**
 * Importa un módulo lazy; si el chunk 404 por deploy, recarga el documento una vez.
 * Exportado para tests unitarios.
 */
export async function importWithChunkRetry<T extends ComponentType<unknown>>(
  importer: ModuleImporter<T>,
  reload: (url: string) => void = (url) => {
    window.location.replace(url);
  },
  href: string = typeof window !== 'undefined' ? window.location.href : 'https://nugacore.local/',
): Promise<{ default: T }> {
  try {
    const mod = await importer();
    clearChunkReloadFlag();
    return mod;
  } catch (error) {
    if (!isChunkLoadError(error)) throw error;

    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
    } catch {
      reloaded = false;
    }

    if (!reloaded) {
      try {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      } catch {
        /* ignore */
      }
      const url = new URL(href);
      url.searchParams.set('_nc', String(Date.now()));
      reload(url.toString());
      return { default: (() => null) as unknown as T };
    }

    clearChunkReloadFlag();
    throw error;
  }
}

/**
 * React.lazy con reintento tras deploy: si el chunk JS cambió de hash
 * (pestaña vieja o SW), recarga una vez y vuelve a importar.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: ModuleImporter<T>,
): LazyExoticComponent<T> {
  return lazy(() => importWithChunkRetry(importer));
}
