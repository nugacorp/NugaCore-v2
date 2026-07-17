import type { NextFunction, Request, Response } from 'express';
import { DEFAULT_TENANT_ID } from '../domains/tenancy/types';
import { getWispOnboardingService } from '../domains/wisp-onboarding/service';

const ALLOW_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/wisp-onboarding',
  '/api/tenancy',
  '/api/system',
  '/api/metrics',
];

const isAllowlisted = (path: string): boolean =>
  ALLOW_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Bloquea APIs de negocio mientras el tenant tenga onboarding incompleto.
 * El wizard UI no basta: sin esto un admin podría saltarse el flujo vía REST.
 */
export const enforceWispOnboarding = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.authContext) {
      next();
      return;
    }
    if (isAllowlisted(req.path)) {
      next();
      return;
    }
    const tenantId = req.authContext.tenantId || DEFAULT_TENANT_ID;
    if (tenantId === DEFAULT_TENANT_ID) {
      next();
      return;
    }
    const required = await getWispOnboardingService().isOnboardingRequired(tenantId);
    if (!required) {
      next();
      return;
    }
    res.status(403).json({
      error: 'WISP onboarding incomplete. Complete the setup wizard first.',
      code: 'ONBOARDING_REQUIRED',
      tenantId,
    });
  } catch (err) {
    // Fail-closed para tenants no-default
    const tenantId = req.authContext?.tenantId;
    if (tenantId && tenantId !== DEFAULT_TENANT_ID) {
      res.status(503).json({
        error: 'Could not verify onboarding status',
        code: 'ONBOARDING_CHECK_FAILED',
      });
      return;
    }
    next(err);
  }
};
