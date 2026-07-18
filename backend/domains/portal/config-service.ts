import { BadRequestError } from '../../common/errors';
import {
  DEFAULT_PORTAL_FEATURES,
  PORTAL_FEATURE_KEYS,
  type PortalConfig,
  type PortalFeatureKey,
  type PortalFeatures,
  type PortalFeaturesPatch,
} from './types';

const configs = new Map<string, { features: PortalFeatures; updatedAt: string }>();

const stamp = () => new Date().toISOString();

const normalizeFeatures = (input?: PortalFeaturesPatch | null): PortalFeatures => {
  const base = { ...DEFAULT_PORTAL_FEATURES };
  if (!input || typeof input !== 'object') return base;
  for (const key of PORTAL_FEATURE_KEYS) {
    if (typeof input[key] === 'boolean') base[key] = input[key]!;
  }
  return base;
};

export const getPortalFeatures = (tenantId: string): PortalFeatures =>
  normalizeFeatures(configs.get(tenantId)?.features);

export const getPortalConfig = (tenantId: string): PortalConfig => {
  const row = configs.get(tenantId);
  return {
    tenantId,
    features: getPortalFeatures(tenantId),
    updatedAt: row?.updatedAt ?? stamp(),
  };
};

export const updatePortalConfig = (
  tenantId: string,
  patch: { features?: PortalFeaturesPatch },
): PortalConfig => {
  if (!tenantId.trim()) throw new BadRequestError('tenantId requerido');
  const next = normalizeFeatures({ ...getPortalFeatures(tenantId), ...(patch.features || {}) });
  const updatedAt = stamp();
  configs.set(tenantId, { features: next, updatedAt });
  return {
    tenantId,
    features: next,
    updatedAt,
  };
};

export const isPortalFeatureEnabled = (tenantId: string, feature: PortalFeatureKey): boolean =>
  getPortalFeatures(tenantId)[feature];

/** Solo tests — reinicia el store en memoria. */
export const resetPortalConfigForTests = (): void => {
  configs.clear();
};
