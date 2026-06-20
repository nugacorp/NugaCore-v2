import type { UserRole } from './supabase';

// ====================================================================
// Helper compartido de RBAC VISUAL (visibilidad de acciones/botones en UI).
//
// Unifica el patrón "lista de roles permitidos + predicado" que antes vivía
// duplicado en cada src/lib/*Rbac.ts con tres estilos incompatibles de
// null-safety. La normalización (trim + lowercase) tolera variaciones de
// capitalización que el rol pueda traer del backend/sesión.
//
// IMPORTANTE: esto solo decide qué VE el usuario. La barrera real de
// escritura está en el RBAC del backend (cada routes.ts); aquí únicamente
// evitamos mostrar acciones que el backend rechazaría con 403.
// ====================================================================

/** Rol entrante: puede venir tipado o como string crudo de la sesión. */
export type RoleInput = UserRole | string | null | undefined;

/**
 * Construye un predicado a partir de los roles permitidos. Devuelve `false`
 * ante null/undefined/cadena vacía o roles desconocidos.
 */
export function createRoleGuard(allowedRoles: readonly UserRole[]): (role: RoleInput) => boolean {
  const allowed = new Set(allowedRoles.map((r) => r.toLowerCase()));
  return (role: RoleInput): boolean => {
    if (!role) return false;
    return allowed.has(String(role).trim().toLowerCase());
  };
}
