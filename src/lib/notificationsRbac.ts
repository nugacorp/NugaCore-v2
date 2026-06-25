import type { UserRole } from './supabase';

// Espejo del backend (FASE N). Lectura: todos los roles. Crear/simular/cancelar:
// Super Admin, Administrador, Cobranza, Soporte. Bloqueados de escritura:
// Técnico y Solo lectura.
const READ: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];
const WRITE: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Soporte'];

export const canReadNotifications = (role: UserRole): boolean => READ.includes(role);

export const canWriteNotifications = (role: UserRole): boolean => WRITE.includes(role);
