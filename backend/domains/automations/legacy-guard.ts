import type { Response } from 'express';
import { isDomainOnDb } from '../../config/feature-flags';

const isProduction = (): boolean =>
  (process.env.NODE_ENV || 'development').trim() === 'production';

/** Motor legacy de automations (store) — deshabilitado en producción o con dominios DB. */
export const legacyAutomationsDisabled = (): boolean =>
  isProduction()
  || isDomainOnDb('suspension')
  || isDomainOnDb('customers');

export const rejectLegacyAutomations = (res: Response): void => {
  res.status(410).json({
    error: 'Legacy automations disabled. Use Automation Center (PROD-8) and POST /api/suspension/evaluate-all.',
    code: 'LEGACY_AUTOMATIONS_DISABLED',
  });
};
