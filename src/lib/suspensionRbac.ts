// ====================================================================
// RBAC visual del Motor de Suspensiones (Fase 4.5) — espejo del backend.
//
//   ver:      SA / Admin / Cobranza / Técnico / Solo lectura
//   evaluar:  SA / Admin / Cobranza
//   política: SA / Admin
//   Soporte:  sin acceso al módulo
// ====================================================================

import type { UserRole } from './supabase';
import { createRoleGuard } from './roleGuard';

const EVALUATE: readonly UserRole[] = ['Super Admin', 'Administrador', 'Cobranza'];
const POLICY: readonly UserRole[] = ['Super Admin', 'Administrador'];

/** ¿Puede disparar evaluaciones (generar órdenes)? */
export const canEvaluateSuspension = createRoleGuard(EVALUATE);

/** ¿Puede editar la política de suspensiones? */
export const canManageSuspensionPolicy = createRoleGuard(POLICY);
