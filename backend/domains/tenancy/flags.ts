import { isHardenedRuntimeNow } from '../../config/env';

/** Flag runtime: MULTI_TENANT_ENABLED=true activa aislamiento por tenant. */
export const isMultiTenantEnabled = (): boolean =>
  (process.env.MULTI_TENANT_ENABLED || 'false').trim().toLowerCase() === 'true';

// ====================================================================
// Gate legacy single-WISP (MT-02).
//
// La resolución de tenant es fail-closed: sin membresía activa no hay
// contexto autorizado. El ÚNICO camino que conserva el viejo fallback a
// `tenant-default` es este gate, y tiene dos condiciones acumulativas:
//
//   1. Configuración afirmativa y explícita: LEGACY_SINGLE_WISP_FALLBACK=true.
//      Ausente, vacío, "1" o "yes" NO cuentan.
//   2. Runtime NO endurecido. En producción o PUBLIC_DEPLOYMENT queda
//      apagado siempre, aunque la variable esté en "true".
//
// Un fallo técnico (DB caída) nunca lo activa: el gate solo cubre la
// ausencia legítima de memberships en instalaciones single-WISP.
// ====================================================================
export const LEGACY_SINGLE_WISP_FALLBACK_ENV = 'LEGACY_SINGLE_WISP_FALLBACK';

/** Decisión pura del gate (testeable sin tocar process.env). */
export const computeLegacySingleWispFallback = (
  hardenedRuntime: boolean,
  envValue: string | undefined,
): boolean => {
  if (hardenedRuntime) return false;
  return (envValue || '').trim().toLowerCase() === 'true';
};

export const isLegacySingleWispFallbackEnabled = (): boolean =>
  computeLegacySingleWispFallback(
    isHardenedRuntimeNow(),
    process.env[LEGACY_SINGLE_WISP_FALLBACK_ENV],
  );
