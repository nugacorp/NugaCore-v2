// ====================================================================
// Feature flags por dominio.
//
// Propósito (Fase 0): dejar listo el interruptor que en Fase 1+ permitirá
// alternar cada dominio entre el store en memoria y la capa repository/DB,
// SIN un "big bang". En Fase 0 TODOS están en `false` (store en memoria).
//
// Uso futuro (Fase 1):
//   import { isDomainOnDb } from '../config/feature-flags';
//   const repo = isDomainOnDb('clients') ? clientsDbRepo : clientsStoreRepo;
//
// No conecta Supabase ni cambia comportamiento por sí solo.
// ====================================================================

const asBool = (value: string | undefined): boolean =>
  (value || 'false').trim().toLowerCase() === 'true';

export type DomainKey =
  | 'clients'
  | 'plans'
  | 'billing'
  | 'suspension'
  | 'network'
  | 'ftth'
  | 'inventory'
  | 'support'
  | 'mikrotik'
  | 'dashboard'
  | 'gis'
  | 'automations'
  | 'reports'
  | 'security';

// Mapa dominio -> variable de entorno (USE_DB_<DOMINIO>).
const FLAG_ENV: Record<DomainKey, string> = {
  clients: 'USE_DB_CLIENTS',
  plans: 'USE_DB_PLANS',
  billing: 'USE_DB_BILLING',
  suspension: 'USE_DB_SUSPENSION',
  network: 'USE_DB_NETWORK',
  ftth: 'USE_DB_FTTH',
  inventory: 'USE_DB_INVENTORY',
  support: 'USE_DB_SUPPORT',
  mikrotik: 'USE_DB_MIKROTIK',
  dashboard: 'USE_DB_DASHBOARD',
  gis: 'USE_DB_GIS',
  automations: 'USE_DB_AUTOMATIONS',
  reports: 'USE_DB_REPORTS',
  security: 'USE_DB_SECURITY',
};

const buildFlags = (): Record<DomainKey, boolean> => {
  const entries = (Object.keys(FLAG_ENV) as DomainKey[]).map((domain) => [
    domain,
    asBool(process.env[FLAG_ENV[domain]]),
  ] as const);
  return Object.fromEntries(entries) as Record<DomainKey, boolean>;
};

export const featureFlags: Record<DomainKey, boolean> = buildFlags();

/** ¿El dominio debe leer/escribir contra la base de datos (en vez del store)? */
export const isDomainOnDb = (domain: DomainKey): boolean => featureFlags[domain] === true;

/** Lista de dominios actualmente apuntando a la DB (para diagnósticos/health). */
export const domainsOnDb = (): DomainKey[] =>
  (Object.keys(featureFlags) as DomainKey[]).filter((d) => featureFlags[d]);
