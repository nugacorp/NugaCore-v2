// ====================================================================
// RBAC visual de Payments a nivel de ACCIÓN (botones), no de módulo.
//
// El backend ya protege las escrituras (WRITE_ROLES en
// backend/domains/payments/routes.ts = super admin / administrador / cobranza).
// Aquí replicamos esa regla SOLO para decidir la visibilidad del botón
// "Nueva Orden" y el bloque "Reactivación Lógica Manual", evitando mostrar
// acciones que el backend rechazaría con 403. Roles de lectura ven la UI
// en modo consulta.
// ====================================================================

import type { UserRole } from './supabase';

const PAYMENTS_WRITE_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza'];

/** ¿El rol puede crear órdenes y disparar reactivación lógica? */
export function canWritePayments(role: UserRole | string | null | undefined): boolean {
  if (!role) return false;
  const normalized = String(role).trim().toLowerCase();
  return PAYMENTS_WRITE_ROLES.some((r) => r.toLowerCase() === normalized);
}
