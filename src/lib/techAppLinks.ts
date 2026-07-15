// ====================================================================
// Enlace de la App Técnicos (PWA) — URL pública compartible.
//
// El técnico abre `/?app=tech`, inicia sesión y entra directo a su app
// de campo (órdenes, agenda, cola offline).
// ====================================================================

import { APP_SCOPE_QUERY_KEY } from './appScope';

/** Construye la URL absoluta de la App Técnicos. */
export function buildTechAppShareUrl(origin: string): string {
  const base = origin.replace(/\/$/, '');
  const url = new URL(base.includes('://') ? base : `https://${base}`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set(APP_SCOPE_QUERY_KEY, 'tech');
  return url.toString();
}
