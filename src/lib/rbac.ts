import { UserRole } from './supabase';

export type AppTab =
  | 'dashboard'
  | 'noc'
  | 'crm'
  | 'billing'
  | 'finance'
  | 'suspension'
  | 'network'
  | 'mikrotik'
  | 'wireguard'
  | 'routeros-resources'
  | 'routeros-templates'
  | 'router-enrollment'
  | 'payments'
  | 'support'
  | 'inventory'
  | 'inventory-routers'
  | 'gis'
  | 'owner'
  | 'manual-safe-mode'
  | 'safe-command-queue';

// ====================================================================
// RBAC visual: qué módulos (tabs) ve cada rol. Mapeado a los tabs
// EXISTENTES (no se crean módulos nuevos). Las distinciones de "lectura"
// se aplican por RBAC del backend en las escrituras; aquí solo se decide
// la VISIBILIDAD del módulo.
// ====================================================================
const roleTabs: Record<UserRole, AppTab[]> = {
  'Super Admin':  ['dashboard', 'noc', 'crm', 'billing', 'finance', 'suspension', 'payments', 'network', 'mikrotik', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'inventory', 'inventory-routers', 'gis', 'owner', 'manual-safe-mode', 'safe-command-queue'],
  'Administrador':['dashboard', 'noc', 'crm', 'billing', 'suspension', 'payments', 'network', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'inventory', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue'],
  'Cobranza':     ['dashboard', 'crm', 'billing', 'finance', 'suspension', 'payments'],
  'Técnico':      ['dashboard', 'noc', 'suspension', 'network', 'mikrotik', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'inventory', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue'],
  'Soporte':      ['dashboard', 'noc', 'crm', 'support', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue'],
  'Solo lectura': ['dashboard', 'noc', 'crm', 'billing', 'suspension', 'network', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue'],
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
  noc: 'NOC Read-Only',
  crm: 'CRM Clientes & Leads',
  billing: 'Facturación & Cobros',
  finance: 'Finanzas & EBITDA',
  suspension: 'Suspensiones & Cortes',
  network: 'Red WISP & FTTH',
  mikrotik: 'MikroTik Core',
  wireguard: 'WireGuard Manager',
  'routeros-resources': 'Recursos MikroTik',
  'routeros-templates': 'Templates RouterOS',
  'router-enrollment': 'Enrollment WireGuard',
  payments: 'Portal Pagos & Reactivación',
  support: 'Soporte & OT',
  inventory: 'Inventario / ERP',
  'inventory-routers': 'Inventario Routers (RO)',
  gis: 'GIS & Cobertura',
  owner: 'Owner & Automatizaciones',
  'manual-safe-mode': 'Modo Seguro Manual',
  'safe-command-queue': 'Cola de Comandos (Dry-Run)',
};

export const getModuleLabel = (tab: string): string => MODULE_LABELS[tab as AppTab] || tab;
