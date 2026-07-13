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
  | 'customers'
  | 'plans'
  | 'billing'
  | 'suspension'
  | 'network'
  | 'ftth'
  | 'inventory'
  | 'support'
  | 'commercial'
  | 'purchases'
  | 'finance'
  | 'mikrotik'
  | 'dashboard'
  | 'gis'
  | 'automations'
  | 'reports'
  | 'security'
  | 'payments';

// Mapa dominio -> variable de entorno (USE_DB_<DOMINIO>).
const FLAG_ENV: Record<DomainKey, string> = {
  customers: 'USE_DB_CUSTOMERS',
  plans: 'USE_DB_PLANS',
  billing: 'USE_DB_BILLING',
  suspension: 'USE_DB_SUSPENSION',
  network: 'USE_DB_NETWORK',
  ftth: 'USE_DB_FTTH',
  inventory: 'USE_DB_INVENTORY',
  support: 'USE_DB_SUPPORT',
  commercial: 'USE_DB_COMMERCIAL',
  purchases: 'USE_DB_PURCHASES',
  finance: 'USE_DB_FINANCE',
  mikrotik: 'USE_DB_MIKROTIK',
  dashboard: 'USE_DB_DASHBOARD',
  gis: 'USE_DB_GIS',
  automations: 'USE_DB_AUTOMATIONS',
  reports: 'USE_DB_REPORTS',
  security: 'USE_DB_SECURITY',
  payments: 'USE_DB_PAYMENTS',
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
export const isDomainOnDb = (domain: DomainKey): boolean =>
  asBool(process.env[FLAG_ENV[domain]]);

/** Lista de dominios actualmente apuntando a la DB (para diagnósticos/health). */
export const domainsOnDb = (): DomainKey[] =>
  (Object.keys(featureFlags) as DomainKey[]).filter((d) => featureFlags[d]);

// ── Router Enrollment (Fase 4.9.2.1) ───────────────────────────────────
// Flag independiente del mapa DomainKey (enrollment no es un dominio de
// negocio del health check). Mismo patrón directo que USE_DB_WIREGUARD.
//
//   false (default) → store en memoria
//   true            → SupabaseRouterEnrollmentRepository
//
// Se lee en cada consulta (no se cachea en módulo) para que los tests
// puedan alternarlo reconstruyendo el repositorio con resetEnrollmentRepository().
export const useDbRouterEnrollment = (): boolean =>
  asBool(process.env.USE_DB_ROUTER_ENROLLMENT);

// ── WireGuard Manager (Fase 4.9.2.1) ───────────────────────────────────
// Flag independiente del mapa DomainKey (la persistencia de WireGuard no es
// un dominio de negocio del health check). Mismo patrón directo que
// router-enrollment. Centralizado aquí (ARCH-1) como única fuente de verdad;
// el servicio WireGuard delega en este helper. Comportamiento idéntico.
//
//   false (default) → store en memoria
//   true            → SupabaseWireguardRepository
export const useDbWireguard = (): boolean =>
  asBool(process.env.USE_DB_WIREGUARD);
