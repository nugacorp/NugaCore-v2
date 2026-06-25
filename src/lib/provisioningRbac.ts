import type { UserRole } from './supabase';

export const canWriteProvisioning = (role: UserRole): boolean =>
  role === 'Super Admin' || role === 'Administrador' || role === 'Cobranza';

export const canReadProvisioning = (role: UserRole): boolean =>
  ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'].includes(role);
