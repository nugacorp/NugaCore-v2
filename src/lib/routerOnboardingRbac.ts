// ====================================================================
// RBAC del Router Onboarding Wizard (Fase 4.9).
//
// Mismos roles que enrollment: Super Admin, Administrador, Técnico.
// Cobranza, Soporte y Solo lectura NO pueden agregar routers.
// ====================================================================

import type { UserRole } from './supabase';

const ONBOARDING_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];

/** ¿El rol puede iniciar el onboarding wizard de un nuevo router? */
export function canStartRouterOnboarding(role: UserRole | string | null | undefined): boolean {
  if (!role) return false;
  const normalized = String(role).trim().toLowerCase();
  return ONBOARDING_ROLES.some((r) => r.toLowerCase() === normalized);
}
