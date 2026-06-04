// ====================================================================
// RBAC visual de Billing a nivel de ACCIÓN (botones), no de módulo.
//
// El backend ya protege las escrituras (WRITE_ROLES en
// backend/domains/billing/routes.ts = super admin / administrador / cobranza).
// Aquí replicamos esa regla SOLO para decidir la visibilidad de los botones
// crear / pagar / editar y evitar mostrar acciones que el backend rechazaría
// con 403. Roles de lectura (técnico / soporte / solo lectura) ven la UI en
// modo consulta.
// ====================================================================

import type { UserRole } from './supabase';

// Roles del frontend que pueden mutar facturación. Espejo de WRITE_ROLES del
// backend (mapeado a las etiquetas de UserRole de src/lib/supabase.ts).
const BILLING_WRITE_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza'];

/** ¿El rol puede crear factura, registrar pago y editar factura? */
export function canManageBilling(role: UserRole | null | undefined): boolean {
  return !!role && BILLING_WRITE_ROLES.includes(role);
}
