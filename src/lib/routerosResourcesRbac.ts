import type { UserRole } from './supabase';
import { createRoleGuard } from './roleGuard';

// Roles con acceso al módulo RouterOS Resources.
const GENERATE_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const VIEW_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador', 'Técnico', 'Solo lectura'];
const HISTORY_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador'];

export const canGenerateResource = createRoleGuard(GENERATE_ROLES);

export const canViewTemplates = createRoleGuard(VIEW_ROLES);

export const canViewHistory = createRoleGuard(HISTORY_ROLES);
