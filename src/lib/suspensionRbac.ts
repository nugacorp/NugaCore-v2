// ====================================================================
// RBAC visual del Motor de Suspensiones (Fase 4.5) — espejo del backend.
//
//   ver:      SA / Admin / Cobranza / Técnico / Solo lectura
//   evaluar:  SA / Admin / Cobranza
//   política: SA / Admin
//   Soporte:  sin acceso al módulo
// ====================================================================

import type { UserRole } from './supabase';

const EVALUATE: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza'];
const POLICY: UserRole[] = ['Super Admin', 'Administrador'];

/** ¿Puede disparar evaluaciones (generar órdenes)? */
export const canEvaluateSuspension = (role: UserRole | null | undefined): boolean =>
  !!role && EVALUATE.includes(role);

/** ¿Puede editar la política de suspensiones? */
export const canManageSuspensionPolicy = (role: UserRole | null | undefined): boolean =>
  !!role && POLICY.includes(role);
