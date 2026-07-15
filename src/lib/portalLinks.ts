// ====================================================================
// Enlaces del Portal del Cliente — URL pública compartible.
//
// El cliente abre `/?app=portal&client=<id>`, inicia sesión y ve su cuenta.
// Staff usa el mismo enlace para preview / compartir por WhatsApp/email.
// ====================================================================

import { APP_SCOPE_QUERY_KEY } from './appScope';

export const PORTAL_CLIENT_QUERY_KEY = 'client';

/** Construye la URL absoluta del portal para un cliente. */
export function buildPortalShareUrl(origin: string, clientId: string): string {
  const id = clientId.trim();
  if (!id) throw new Error('clientId requerido');
  const base = origin.replace(/\/$/, '');
  const url = new URL(base.includes('://') ? base : `https://${base}`);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set(APP_SCOPE_QUERY_KEY, 'portal');
  url.searchParams.set(PORTAL_CLIENT_QUERY_KEY, id);
  return url.toString();
}

/** Lee `client` (o alias `clientId`) de un query string. */
export function readPortalClientIdFromSearch(search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const id = (params.get(PORTAL_CLIENT_QUERY_KEY) || params.get('clientId') || '').trim();
  return id || null;
}
