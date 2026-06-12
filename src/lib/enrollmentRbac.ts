import { UserRole } from './supabase';

const ENROLL_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const REVOKE_ROLES: UserRole[] = ['Super Admin', 'Administrador'];

export const canStartEnrollment = (role: UserRole): boolean => ENROLL_ROLES.includes(role);
export const canRevokeEnrollment = (role: UserRole): boolean => REVOKE_ROLES.includes(role);
export const canAccessEnrollmentModule = (role: UserRole): boolean => ENROLL_ROLES.includes(role);
