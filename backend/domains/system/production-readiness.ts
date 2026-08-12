// ====================================================================
// Production readiness — gates operativos para declarar producción real.
//
// Agrega un SSOT machine-readable que resume qué bloqueadores quedan
// antes de operar un WISP con datos reales. No sustituye la validación
// humana/Hermes ni toca routers ni migraciones.
// ====================================================================

import { env, isHardenedRuntime, isProduction } from '../../config/env';
import { domainsOnDb, featureFlags, type DomainKey } from '../../config/feature-flags';
import { useDbRouterEnrollment, useDbWireguard } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, pingSupabase } from '../../services/supabase-admin';
import { portalAuthStatus } from '../portal/auth';
import { runDataConsistencyCheck } from './consistency';
import { productionRestoreEvidenceVerified } from '../../config/restore-evidence';

const CRITICAL_DOMAINS = [
  'customers', 'plans', 'billing', 'support', 'inventory', 'suspension', 'payments',
] as const satisfies readonly DomainKey[];

export type ReadinessGate = {
  id: string;
  label: string;
  passed: boolean;
  severity: 'blocker' | 'warning';
  detail: string;
};

export type ProductionReadinessReport = {
  checkedAt: string;
  environment: string;
  hardenedRuntime: boolean;
  readyForProduction: boolean;
  blockers: string[];
  warnings: string[];
  gates: ReadinessGate[];
  summary: {
    blockersPassed: number;
    blockersTotal: number;
    warningsPassed: number;
    warningsTotal: number;
  };
};

const asBool = (value: string | undefined): boolean =>
  (value || 'false').trim().toLowerCase() === 'true';

const webhookProviderConfigured = (prefix: string): boolean =>
  (process.env[`WEBHOOK_SECRET_${prefix}`] || '').trim().length > 0;

export async function buildProductionReadinessReport(): Promise<ProductionReadinessReport> {
  const criticalOn = CRITICAL_DOMAINS.filter((d) => featureFlags[d]);
  const mikrotikLive = asBool(process.env.MIKROTIK_WORKER_LIVE);
  const restoreTested = productionRestoreEvidenceVerified();
  const quickLoginEnabled = asBool(process.env.VITE_ENABLE_QUICK_LOGIN);
  const portal = portalAuthStatus();
  const dbRequired = domainsOnDb().length > 0;
  const supabaseReachable = dbRequired ? await pingSupabase() : true;
  const consistency = await runDataConsistencyCheck();

  const paymentsOnDb = featureFlags.payments;
  const webhookManualOk = !isHardenedRuntime
    || !paymentsOnDb
    || webhookProviderConfigured('MANUAL');

  const gates: ReadinessGate[] = [
    {
      id: 'supabase_configured',
      label: 'Supabase configurado',
      passed: isSupabaseAdminConfigured,
      severity: 'blocker',
      detail: isSupabaseAdminConfigured
        ? 'SUPABASE_URL y service role presentes'
        : 'Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    },
    {
      id: 'critical_persistence',
      label: 'Persistencia crítica (USE_DB_* core)',
      passed: criticalOn.length === CRITICAL_DOMAINS.length,
      severity: 'blocker',
      detail: `${criticalOn.length}/${CRITICAL_DOMAINS.length} dominios críticos en DB`,
    },
    {
      id: 'store_fallback_off',
      label: 'Sin fallback a store en memoria (core)',
      passed: criticalOn.length === CRITICAL_DOMAINS.length,
      severity: 'blocker',
      detail: criticalOn.length === CRITICAL_DOMAINS.length
        ? 'storeFallbackActive=false'
        : 'Al menos un dominio crítico sigue en memoria',
    },
    {
      id: 'supabase_reachable',
      label: 'Supabase alcanzable',
      passed: !dbRequired || supabaseReachable,
      severity: 'blocker',
      detail: dbRequired
        ? (supabaseReachable ? 'Ping OK' : 'No se pudo consultar Supabase')
        : 'Sin dominios en DB — omitido',
    },
    {
      id: 'auth_trust_headers_off',
      label: 'AUTH_TRUST_HEADERS desactivado',
      passed: !isHardenedRuntime || !env.AUTH_TRUST_HEADERS,
      severity: 'blocker',
      detail: env.AUTH_TRUST_HEADERS
        ? 'Headers manipulables activos en runtime endurecido'
        : 'Identidad solo por JWT verificado',
    },
    {
      id: 'hardened_runtime',
      label: 'Runtime endurecido (prod o PUBLIC_DEPLOYMENT)',
      passed: isHardenedRuntime,
      severity: 'blocker',
      detail: isHardenedRuntime
        ? `NODE_ENV=${env.NODE_ENV}, PUBLIC_DEPLOYMENT=${env.PUBLIC_DEPLOYMENT}`
        : 'Activar NODE_ENV=production o PUBLIC_DEPLOYMENT=true',
    },
    {
      id: 'mikrotik_credentials_key',
      label: 'MIKROTIK_CREDENTIALS_KEY presente',
      passed: !isHardenedRuntime || Boolean(env.MIKROTIK_CREDENTIALS_KEY),
      severity: 'blocker',
      detail: env.MIKROTIK_CREDENTIALS_KEY
        ? 'Cifrado de credenciales disponible'
        : 'Clave de cifrado ausente en runtime endurecido',
    },
    {
      id: 'mikrotik_live_off',
      label: 'MIKROTIK_WORKER_LIVE desactivado',
      passed: !mikrotikLive,
      severity: 'blocker',
      detail: mikrotikLive ? 'Live activo — requiere autorización explícita' : 'Gated off',
    },
    {
      id: 'mikrotik_db_off',
      label: 'USE_DB_MIKROTIK desactivado',
      passed: !featureFlags.mikrotik,
      severity: 'blocker',
      detail: featureFlags.mikrotik
        ? 'MikroTik DB requiere validación Hermes'
        : 'Gated off por diseño',
    },
    {
      id: 'data_consistency',
      label: 'Consistencia de KPIs',
      passed: consistency.healthy,
      severity: 'blocker',
      detail: consistency.healthy
        ? 'Sin desajustes entre fuentes y dashboard'
        : `${consistency.mismatches.length} desajuste(s) detectado(s)`,
    },
    {
      id: 'restore_tested',
      label: 'Backup + restore probado',
      passed: restoreTested,
      severity: 'blocker',
      detail: restoreTested
        ? 'Evidencia productiva machine-readable verificada'
        : 'Falta evidencia productiva completa; staging no satisface este gate',
    },
    {
      id: 'webhook_secrets',
      label: 'Secretos de webhook configurados',
      passed: webhookManualOk,
      severity: 'blocker',
      detail: webhookManualOk
        ? 'WEBHOOK_SECRET_MANUAL presente o pagos no en DB'
        : 'Runtime endurecido con pagos en DB sin WEBHOOK_SECRET_MANUAL',
    },
    {
      id: 'portal_jwt_mode',
      label: 'Portal sin token staging',
      passed: !isProduction || portal.mode !== 'staging-token',
      severity: 'blocker',
      detail: portal.mode === 'staging-token'
        ? 'PORTAL_STAGING_TOKEN activo — migrar a JWT cliente'
        : `Modo portal: ${portal.mode}`,
    },
    {
      id: 'quick_login_off',
      label: 'Quick login desactivado',
      passed: !isProduction || !quickLoginEnabled,
      severity: 'blocker',
      detail: quickLoginEnabled
        ? 'VITE_ENABLE_QUICK_LOGIN=true en producción'
        : 'Acceso rápido desactivado',
    },
    {
      id: 'router_enrollment_db',
      label: 'Router enrollment persistido',
      passed: !isProduction || useDbRouterEnrollment(),
      severity: 'warning',
      detail: useDbRouterEnrollment()
        ? 'USE_DB_ROUTER_ENROLLMENT=true'
        : 'Recomendado para download post-restart',
    },
    {
      id: 'wireguard_persistence',
      label: 'WireGuard persistido o snapshot',
      passed: !isProduction || useDbWireguard() || asBool(process.env.USE_WIREGUARD_SNAPSHOT),
      severity: 'warning',
      detail: useDbWireguard()
        ? 'USE_DB_WIREGUARD=true'
        : asBool(process.env.USE_WIREGUARD_SNAPSHOT)
          ? 'Snapshot alternativo activo'
          : 'Evaluar USE_DB_WIREGUARD o wireguard_snapshot',
    },
    {
      id: 'cors_allowlist',
      label: 'CORS allowlist definido',
      passed: !isHardenedRuntime || Boolean((process.env.CORS_ALLOWED_ORIGINS || '').trim()),
      severity: 'warning',
      detail: (process.env.CORS_ALLOWED_ORIGINS || '').trim()
        ? 'CORS_ALLOWED_ORIGINS configurado'
        : 'Definir dominios permitidos en runtime público',
    },
  ];

  const blockers = gates.filter((g) => g.severity === 'blocker');
  const warnings = gates.filter((g) => g.severity === 'warning');
  const failedBlockers = blockers.filter((g) => !g.passed).map((g) => g.id);
  const failedWarnings = warnings.filter((g) => !g.passed).map((g) => g.id);

  return {
    checkedAt: new Date().toISOString(),
    environment: env.NODE_ENV,
    hardenedRuntime: isHardenedRuntime,
    readyForProduction: failedBlockers.length === 0,
    blockers: failedBlockers,
    warnings: failedWarnings,
    gates,
    summary: {
      blockersPassed: blockers.filter((g) => g.passed).length,
      blockersTotal: blockers.length,
      warningsPassed: warnings.filter((g) => g.passed).length,
      warningsTotal: warnings.length,
    },
  };
}
