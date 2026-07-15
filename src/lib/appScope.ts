import { UserRole } from './supabase';
import { canAccessTab, getDefaultTabByRole, type AppTab } from './rbac';

// ====================================================================
// App Scope — una sola SPA servida como varias PWAs instalables.
//
// NugaCore navega por `activeTab` en estado (no por path). Para instalar la
// misma app como PWAs distintas (Admin, Técnicos, Portal Cliente) sin meter un
// router, cada manifest declara su `start_url` con un query `?app=<scope>`
// (p.ej. `/?app=tech`). Al arrancar leemos ese scope para: (1) elegir el
// manifest/identidad correcta y (2) abrir en la pantalla adecuada.
//
// Aditivo y retrocompatible: sin `?app=`, el scope es `admin` y el
// comportamiento es idéntico al histórico.
// ====================================================================

export type AppScope = 'admin' | 'tech' | 'portal';

export const APP_SCOPE_QUERY_KEY = 'app';
const APP_SCOPE_STORAGE_KEY = 'nugacore.appScope';
const VALID_SCOPES: readonly AppScope[] = ['admin', 'tech', 'portal'];

// Pantalla de entrada preferida por scope (si el rol la puede acceder).
const SCOPE_ENTRY_TAB: Record<Exclude<AppScope, 'admin'>, AppTab> = {
  tech: 'tech-pwa',
  portal: 'portal',
};

/** Normaliza un valor crudo (query o storage) a un AppScope válido. Puro. */
export function parseAppScope(raw: string | null | undefined): AppScope {
  return raw && (VALID_SCOPES as readonly string[]).includes(raw)
    ? (raw as AppScope)
    : 'admin';
}

/**
 * Tab de entrada para (rol, scope). Si el scope pide un módulo que el rol no
 * puede ver, cae al default seguro del rol. Puro (sin `window`, testeable).
 */
export function resolveEntryTab(role: UserRole, scope: AppScope): AppTab {
  if (scope !== 'admin') {
    const preferred = SCOPE_ENTRY_TAB[scope];
    if (canAccessTab(role, preferred)) return preferred;
  }
  return getDefaultTabByRole(role);
}

/** Ruta al manifest de cada scope (identidad de la PWA). Puro. */
export function manifestPathForScope(scope: AppScope): string {
  switch (scope) {
    case 'tech':
      return '/manifest.tech.json';
    case 'portal':
      return '/manifest.portal.json';
    default:
      return '/manifest.json';
  }
}

let cachedScope: AppScope | null = null;

/**
 * Scope efectivo del arranque actual. Lee `?app=` de la URL; si no viene, usa
 * el último scope recordado en `sessionStorage`; default `admin`. Cachea el
 * resultado por carga y tolera entornos sin `window` (SSR/tests → `admin`).
 */
export function getAppScope(): AppScope {
  if (cachedScope) return cachedScope;
  let scope: AppScope;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get(APP_SCOPE_QUERY_KEY);
    if (fromQuery) {
      scope = parseAppScope(fromQuery);
      window.sessionStorage.setItem(APP_SCOPE_STORAGE_KEY, scope);
    } else {
      scope = parseAppScope(window.sessionStorage.getItem(APP_SCOPE_STORAGE_KEY));
    }
  } catch {
    scope = 'admin';
  }
  cachedScope = scope;
  return scope;
}

/** Solo para tests: limpia el scope cacheado. */
export function __resetAppScopeCache(): void {
  cachedScope = null;
}
