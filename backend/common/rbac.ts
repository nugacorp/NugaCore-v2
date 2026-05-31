import { NextFunction, Request, Response } from 'express';
import { ActionPermissionKey, hasActionPermission } from './action-permissions';

export type AppRole = 'super admin' | 'administrador' | 'cobranza' | 'tecnico' | 'soporte' | 'solo lectura';

export const normalizeRole = (value: string | string[] | undefined): AppRole | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  const role = (raw || '').trim().toLowerCase();

  if (role === 'super admin' || role === 'superadmin') return 'super admin';
  if (role === 'administrador' || role === 'admin') return 'administrador';
  if (role === 'cobranza') return 'cobranza';
  if (role === 'tecnico' || role === 'técnico') return 'tecnico';
  if (role === 'soporte') return 'soporte';
  if (role === 'solo lectura') return 'solo lectura';
  return null;
};

export const requireRoles = (allowed: AppRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.authContext?.role || null;

    if (!role) {
      res.status(401).json({ error: 'Unauthorized: missing verified auth context' });
      return;
    }

    if (!allowed.includes(role)) {
      res.status(403).json({ error: 'Forbidden: role does not have permission for this action' });
      return;
    }

    next();
  };
};

export const requireAction = (action: ActionPermissionKey) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.authContext?.role || null;

    if (!role) {
      res.status(401).json({ error: 'Unauthorized: missing verified auth context' });
      return;
    }

    if (!hasActionPermission(role, action)) {
      res.status(403).json({ error: `Forbidden: role does not have permission for action ${action}` });
      return;
    }

    next();
  };
};
