import { BadRequestError } from '../../common/errors';
import { logger } from '../../common/logger';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import {
  DEFAULT_PORTAL_FEATURES,
  PORTAL_FEATURE_KEYS,
  type PortalConfig,
  type PortalFeatureKey,
  type PortalFeatures,
  type PortalFeaturesPatch,
} from './types';

// ====================================================================
// Config del portal del cliente, por tenant.
//
// ANTES vivía sólo en este `Map`, sin persistencia: cada reinicio del proceso
// —o sea, cada redeploy— devolvía las cinco features de TODOS los tenants a su
// valor por defecto, que es `true`. Un WISP que desactivaba "ver saldo" en el
// portal de sus abonados lo veía reactivarse solo, sin aviso. Un control de
// privacidad que vuelve a "visible" por su cuenta es un fallo, no una molestia.
//
// AHORA la fuente de verdad es `public.portal_config` cuando Supabase está
// configurado. El `Map` se conserva como respaldo para dos casos legítimos:
// desarrollo local sin Supabase y la suite hermética, que no toca la red.
//
// Lo que se guarda es un PARCIAL: sólo las claves que el WISP cambió. Así una
// feature nueva toma su valor por defecto del código sin tener que tocar las
// filas existentes.
// ====================================================================

const TABLE = 'portal_config';

/** Respaldo en memoria: dev sin Supabase y tests herméticos. */
const configs = new Map<string, { features: PortalFeatures; updatedAt: string }>();

const stamp = () => new Date().toISOString();

const usingDb = (): boolean => isSupabaseAdminConfigured && Boolean(supabaseAdmin);

/** Completa un parcial con los valores por defecto. Ignora claves desconocidas. */
const normalizeFeatures = (input?: PortalFeaturesPatch | null): PortalFeatures => {
  const base = { ...DEFAULT_PORTAL_FEATURES };
  if (!input || typeof input !== 'object') return base;
  for (const key of PORTAL_FEATURE_KEYS) {
    if (typeof input[key] === 'boolean') base[key] = input[key]!;
  }
  return base;
};

/** Sólo las claves que difieren del defecto: es lo que se persiste. */
const toPatch = (features: PortalFeatures): PortalFeaturesPatch => {
  const patch: PortalFeaturesPatch = {};
  for (const key of PORTAL_FEATURE_KEYS) {
    if (features[key] !== DEFAULT_PORTAL_FEATURES[key]) patch[key] = features[key];
  }
  return patch;
};

export const getPortalConfig = async (tenantId: string): Promise<PortalConfig> => {
  if (usingDb()) {
    const { data, error } = await supabaseAdmin!
      .from(TABLE)
      .select('features, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      // Fail-open DELIBERADO: si la lectura falla, el portal sigue en pie con
      // los valores por defecto en vez de caerse entero. Es la misma decisión
      // que tomaba el código anterior por accidente, ahora explícita y con
      // rastro. La alternativa —tumbar el portal del abonado porque no se pudo
      // leer una preferencia— es peor.
      logger.warn('portal.config lectura falló, se usan los valores por defecto', {
        tenantId,
        code: error.code,
        message: error.message,
      });
      return { tenantId, features: { ...DEFAULT_PORTAL_FEATURES }, updatedAt: stamp() };
    }

    const row = data as { features?: PortalFeaturesPatch; updated_at?: string } | null;
    return {
      tenantId,
      features: normalizeFeatures(row?.features),
      updatedAt: row?.updated_at ?? stamp(),
    };
  }

  const row = configs.get(tenantId);
  return {
    tenantId,
    features: normalizeFeatures(row?.features),
    updatedAt: row?.updatedAt ?? stamp(),
  };
};

export const getPortalFeatures = async (tenantId: string): Promise<PortalFeatures> =>
  (await getPortalConfig(tenantId)).features;

export const updatePortalConfig = async (
  tenantId: string,
  patch: { features?: PortalFeaturesPatch },
): Promise<PortalConfig> => {
  if (!tenantId.trim()) throw new BadRequestError('tenantId requerido');

  const current = await getPortalConfig(tenantId);
  const next = normalizeFeatures({ ...current.features, ...(patch.features || {}) });
  const updatedAt = stamp();

  if (usingDb()) {
    const { error } = await supabaseAdmin!
      .from(TABLE)
      .upsert(
        { tenant_id: tenantId, features: toPatch(next), updated_at: updatedAt },
        { onConflict: 'tenant_id' },
      );

    // Aquí NO se falla en silencio: si la escritura no persiste, decirle al
    // WISP que se guardó sería exactamente el defecto que esto arregla — creer
    // que apagaste una feature y encontrártela encendida.
    if (error) {
      logger.error('portal.config no se pudo guardar', {
        tenantId,
        code: error.code,
        message: error.message,
      });
      throw new Error(`No se pudo guardar la configuración del portal: ${error.message}`);
    }
  } else {
    configs.set(tenantId, { features: next, updatedAt });
  }

  return { tenantId, features: next, updatedAt };
};

export const isPortalFeatureEnabled = async (
  tenantId: string,
  feature: PortalFeatureKey,
): Promise<boolean> => (await getPortalFeatures(tenantId))[feature];

/** Solo tests — reinicia el respaldo en memoria. */
export const resetPortalConfigForTests = (): void => {
  configs.clear();
};
