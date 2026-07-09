import type { Response } from 'express';
import { isDomainOnDb } from '../../config/feature-flags';

const isProduction = (): boolean =>
  (process.env.NODE_ENV || 'development').trim() === 'production';

/** Rutas legacy que mutan store — deshabilitadas con motor DB o en producción. */
export const legacySuspensionDisabled = (): boolean =>
  isDomainOnDb('suspension') || isProduction();

export const rejectLegacySuspension = (res: Response): void => {
  res.status(410).json({
    error: 'Legacy suspension API disabled. Use /api/suspension/policies, /evaluate-all, and MikroTik worker.',
    code: 'LEGACY_SUSPENSION_DISABLED',
  });
};
