import { UserRole } from './supabase';

export type AppTab =
  | 'dashboard'
  | 'crm'
  | 'billing'
  | 'finance'
  | 'suspension'
  | 'network'
  | 'mikrotik'
  | 'wireguard'
  | 'routeros-resources'
  | 'routeros-templates'
  | 'support'
  | 'inventory'
  | 'gis'
  | 'owner';

// ====================================================================
// RBAC visual: qué módulos (tabs) ve cada rol. Mapeado a los tabs
// EXISTENTES (no se crean módulos nuevos). Las distinciones de "lectura"
// se aplican por RBAC del backend en las escrituras; aquí solo se decide
// la VISIBILIDAD del módulo.
// ====================================================================
const roleTabs: Record<UserRole, AppTab[]> = {
  'Super Admin':  ['dashboard', 'crm', 'billing', 'finance', 'suspension', 'network', 'mikrotik', 'wireguard', 'routeros-resources', 'routeros-templates', 'support', 'inventory', 'gis', 'owner'],
  'Administrador':['dashboard', 'crm', 'billing', 'suspension', 'network', 'wireguard', 'routeros-resources', 'routeros-templates', 'support', 'inventory', 'gis'],
  'Cobranza':     ['dashboard', 'crm', 'billing', 'finance', 'suspension'],
  'Técnico':      ['dashboard', 'suspension', 'network', 'mikrotik', 'routeros-resources', 'routeros-templates', 'support', 'inventory', 'gis'],
  'Soporte':      ['dashboard', 'crm', 'support', 'gis'],
  'Solo lectura': ['dashboard', 'crm', 'billing', 'suspension', 'network', 'gis'],
};

// Fallback seguro para roles desconocidos / sin rol.
const tabsForRole = (role: UserRole | null | undefined): AppTab[] =>
  (role && roleTabs[role]) ? roleTabs[role] : roleTabs['Solo lectura'];

export function canAccessTab(role: UserRole, tab: string): tab is AppTab {
  return tabsForRole(role).includes(tab as AppTab);
}

export function getAllowedTabsByRole(role: UserRole): AppTab[] {
  return tabsForRole(role);
}

/** Primer módulo permitido del rol (redirección segura). 'dashboard' para todos. */
export function getDefaultTabByRole(role: UserRole): AppTab {
  return tabsForRole(role)[0] ?? 'dashboard';
}

// Etiquetas legibles por módulo (para el panel de perfil).
export const MODULE_LABELS: Record<AppTab, string> = {
  dashboard: 'Dashboard',
  crm: 'CRM Clientes & Leads',
  billing: 'Facturación & Cobros',
  finance: 'Finanzas & EBITDA',
  suspension: 'Suspensiones & Cortes',
  network: 'Red WISP & FTTH',
  mikrotik: 'MikroTik Core',
  wireguard: 'WireGuard Manager',
  'routeros-resources': 'Recursos MikroTik',
  'routeros-templates': 'Templates RouterOS',
  support: 'Soporte & OT',
  inventory: 'Inventario / ERP',
  gis: 'GIS & Cobertura',
  owner: 'Owner & Automatizaciones',
};

export const getModuleLabel = (tab: string): string => MODULE_LABELS[tab as AppTab] || tab;
