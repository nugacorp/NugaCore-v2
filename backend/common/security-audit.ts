import { NextFunction, Request, Response } from 'express';
import { store } from '../state/store';

const shouldSkipPath = (path: string): boolean => {
  if (path.startsWith('/api/security/audit-logs')) return true;
  return false;
};

export const attachSecurityAudit = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = Date.now();

  res.on('finish', () => {
    if (shouldSkipPath(req.path)) return;

    const method = req.method.toUpperCase();
    const shouldAudit = method !== 'OPTIONS';
    if (!shouldAudit) return;

    const sourceHeader = req.headers['x-forwarded-for'];
    const source = Array.isArray(sourceHeader)
      ? sourceHeader[0]
      : sourceHeader || req.ip || 'unknown';

    store.logSecurityAudit({
      actorId: req.authContext?.userId,
      actorRole: req.authContext?.role,
      action: `${method} ${req.path}`,
      resource: req.path,
      method,
      statusCode: res.statusCode,
      success: res.statusCode >= 200 && res.statusCode < 400,
      source: String(source),
      metadata: `durationMs=${Date.now() - startedAt}`,
    });
  });

  next();
};
