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
import { createRoleGuard } from './roleGuard';

const MANAGE: readonly UserRole[] = ['Super Admin', 'Administrador'];
const SCRIPT: readonly UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];

/** ¿Puede crear/editar routers? */
export const canManageRouters = createRoleGuard(MANAGE);

/** ¿Puede generar script de provisioning y probar conexión? */
export const canGenerateScript = createRoleGuard(SCRIPT);

/** ¿Puede rotar credenciales? (acción sensible) */
export const canRotateCredentials = createRoleGuard(MANAGE);
