// ====================================================================
// RBAC del Router Onboarding Wizard (Fase 4.9).
//
// Mismos roles que enrollment: Super Admin, Administrador, Técnico.
// Cobranza, Soporte y Solo lectura NO pueden agregar routers.
// ====================================================================

import type { UserRole } from './supabase';
import { createRoleGuard } from './roleGuard';

const ONBOARDING_ROLES: readonly UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];

/** ¿El rol puede iniciar el onboarding wizard de un nuevo router? */
export const canStartRouterOnboarding = createRoleGuard(ONBOARDING_ROLES);
