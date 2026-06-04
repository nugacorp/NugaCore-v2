// ====================================================================
// RBAC visual del provisioning MikroTik (Fase 4.4) — espejo del backend.
//
// Backend (routes.ts):
//   - ver:            super admin, administrador, técnico, soporte, solo lectura
//   - crear/editar:   super admin, administrador
//   - generar/test:   super admin, administrador, técnico
//   - rotar:          super admin, administrador
//   - Cobranza:       SIN acceso a MikroTik
// ====================================================================

import type { UserRole } from './supabase';

const MANAGE: UserRole[] = ['Super Admin', 'Administrador'];
const SCRIPT: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];

/** ¿Puede crear/editar routers? */
export const canManageRouters = (role: UserRole | null | undefined): boolean =>
  !!role && MANAGE.includes(role);

/** ¿Puede generar script de provisioning y probar conexión? */
export const canGenerateScript = (role: UserRole | null | undefined): boolean =>
  !!role && SCRIPT.includes(role);

/** ¿Puede rotar credenciales? (acción sensible) */
export const canRotateCredentials = (role: UserRole | null | undefined): boolean =>
  !!role && MANAGE.includes(role);
