import { UserRole } from './supabase';

// Roles con acceso al módulo RouterOS Templates Library.
// Visible: Super Admin, Administrador, Técnico
// NO visible: Cobranza, Soporte, Solo lectura
const GENERATE_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const HISTORY_ROLES: UserRole[]  = ['Super Admin', 'Administrador'];

export const canGenerateTemplate = (role: UserRole): boolean =>
  GENERATE_ROLES.includes(role);

export const canViewTemplateHistory = (role: UserRole): boolean =>
  HISTORY_ROLES.includes(role);

export const canAccessTemplatesModule = (role: UserRole): boolean =>
  GENERATE_ROLES.includes(role);
