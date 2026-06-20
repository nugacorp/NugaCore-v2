import type { UserRole } from './supabase';
import { createRoleGuard } from './roleGuard';

// Roles con acceso al módulo RouterOS Templates Library.
// Visible: Super Admin, Administrador, Técnico
// NO visible: Cobranza, Soporte, Solo lectura
const GENERATE_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const HISTORY_ROLES: readonly UserRole[]  = ['Super Admin', 'Administrador'];

export const canGenerateTemplate = createRoleGuard(GENERATE_ROLES);

export const canViewTemplateHistory = createRoleGuard(HISTORY_ROLES);

// Acceder al módulo requiere los mismos roles que generar.
export const canAccessTemplatesModule = canGenerateTemplate;
