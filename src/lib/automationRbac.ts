import type { UserRole } from './supabase';

// Espejo del backend (FASE N): todos los roles tienen lectura y simulacion
// dry-run del Automation Engine. Nadie modifica reglas todavia.
const ALL_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];

export const canReadAutomation = (role: UserRole): boolean => ALL_ROLES.includes(role);

export const canSimulateAutomation = (role: UserRole): boolean => ALL_ROLES.includes(role);
