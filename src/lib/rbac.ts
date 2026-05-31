import { UserRole } from './supabase';

export type AppTab =
  | 'dashboard'
  | 'crm'
  | 'billing'
  | 'finance'
  | 'network'
  | 'mikrotik'
  | 'support'
  | 'inventory'
  | 'gis'
  | 'owner';

const roleTabs: Record<UserRole, AppTab[]> = {
  'Super Admin': ['dashboard', 'crm', 'billing', 'finance', 'network', 'mikrotik', 'support', 'inventory', 'gis', 'owner'],
  'Administrador': ['dashboard', 'crm', 'billing', 'finance', 'network', 'mikrotik', 'support', 'inventory', 'gis', 'owner'],
  'Cobranza': ['dashboard', 'crm', 'billing', 'finance'],
  'Técnico': ['dashboard', 'network', 'support', 'gis'],
  'Soporte': ['dashboard', 'crm', 'network', 'support', 'gis'],
  'Solo lectura': ['dashboard', 'crm', 'network', 'gis'],
};

export function canAccessTab(role: UserRole, tab: string): tab is AppTab {
  return roleTabs[role].includes(tab as AppTab);
}

export function getAllowedTabsByRole(role: UserRole): AppTab[] {
  return roleTabs[role];
}

export function getDefaultTabByRole(role: UserRole): AppTab {
  if (role === 'Técnico' || role === 'Soporte') return 'support';
  if (role === 'Cobranza') return 'billing';
  return 'dashboard';
}
