import type { UserRole } from './supabase';
import { createRoleGuard } from './roleGuard';

const ENROLL_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const REVOKE_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador'];

export const canStartEnrollment = createRoleGuard(ENROLL_ROLES);
export const canRevokeEnrollment = createRoleGuard(REVOKE_ROLES);
// Acceder al módulo requiere los mismos roles que iniciar enrollment.
export const canAccessEnrollmentModule = canStartEnrollment;
