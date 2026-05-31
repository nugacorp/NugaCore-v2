import { AppRole } from './rbac';

export type ActionPermissionKey =
  | 'reports.export'
  | 'reports.view'
  | 'automation.manage'
  | 'automation.execute'
  | 'security.audit.read'
  | 'security.backup.manage'
  | 'security.permissions.read';

const permissionMatrix: Record<ActionPermissionKey, AppRole[]> = {
  'reports.export': ['super admin', 'administrador', 'cobranza', 'soporte'],
  'reports.view': ['super admin', 'administrador', 'cobranza', 'soporte', 'tecnico', 'solo lectura'],
  'automation.manage': ['super admin', 'administrador'],
  'automation.execute': ['super admin', 'administrador', 'cobranza', 'tecnico'],
  'security.audit.read': ['super admin', 'administrador'],
  'security.backup.manage': ['super admin', 'administrador'],
  'security.permissions.read': ['super admin', 'administrador', 'soporte'],
};

export const listPermissionMatrix = () => permissionMatrix;

export const hasActionPermission = (role: AppRole | null | undefined, action: ActionPermissionKey): boolean => {
  if (!role) return false;
  return permissionMatrix[action].includes(role);
};
