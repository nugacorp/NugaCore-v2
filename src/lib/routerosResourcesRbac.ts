import { UserRole } from './supabase';

// Roles con acceso al módulo RouterOS Resources.
const GENERATE_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const VIEW_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico', 'Solo lectura'];
const HISTORY_ROLES: UserRole[] = ['Super Admin', 'Administrador'];

export const canGenerateResource = (role: UserRole): boolean =>
  GENERATE_ROLES.includes(role);

export const canViewTemplates = (role: UserRole): boolean =>
  VIEW_ROLES.includes(role);

export const canViewHistory = (role: UserRole): boolean =>
  HISTORY_ROLES.includes(role);
