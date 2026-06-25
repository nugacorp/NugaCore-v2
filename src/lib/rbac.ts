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
  | 'inventory-sync'
  | 'provisioning'
  | 'gis'
  | 'owner'
  | 'manual-safe-mode'
  | 'safe-command-queue'
  | 'routeros-readonly'
  | 'automation'
  | 'user-manual';

// ====================================================================
// RBAC visual: qué módulos (tabs) ve cada rol. Mapeado a los tabs
// EXISTENTES (no se crean módulos nuevos). Las distinciones de "lectura"
// se aplican por RBAC del backend en las escrituras; aquí solo se decide
// la VISIBILIDAD del módulo.
// ====================================================================
const roleTabs: Record<UserRole, AppTab[]> = {
  'Super Admin':  ['dashboard', 'noc', 'crm', 'billing', 'finance', 'suspension', 'payments', 'network', 'mikrotik', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'inventory', 'inventory-routers', 'gis', 'owner', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'automation', 'user-manual'],
  'Administrador':['dashboard', 'noc', 'crm', 'billing', 'suspension', 'payments', 'network', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'inventory', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'automation', 'user-manual'],
  'Cobranza':     ['dashboard', 'crm', 'billing', 'finance', 'suspension', 'payments', 'provisioning', 'automation', 'user-manual'],
  'Técnico':      ['dashboard', 'noc', 'crm', 'suspension', 'network', 'mikrotik', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'inventory', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'automation', 'user-manual'],
  'Soporte':      ['dashboard', 'noc', 'crm', 'support', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'automation', 'user-manual'],
  'Solo lectura': ['dashboard', 'noc', 'crm', 'billing', 'suspension', 'network', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'automation', 'user-manual'],
};

// ====================================================================
// Visibilidad en el sidebar ≠ acceso (RBAC). Algunos módulos siguen siendo
// ACCESIBLES por su rol (canAccessTab = true, acceso directo por tab/URL y
// render en App.tsx) pero NO se listan como módulos operativos normales en el
// menú principal:
//  - wireguard: infraestructura interna; los peers se crean automáticamente
//    en el Router Enrollment, el WISP no los gestiona a mano.
//  - manual-safe-mode / safe-command-queue: herramientas internas de seguridad
//    para fases futuras (PROD-x); confunden en la operación diaria de un WISP.
// No se eliminan ni se les quita acceso: solo se ocultan del sidebar.
// ====================================================================
const SIDEBAR_HIDDEN_TABS: ReadonlySet<AppTab> = new Set<AppTab>([
  'wireguard',
  'manual-safe-mode',
  'safe-command-queue',
]);

export function isSidebarHiddenTab(tab: string): boolean {
  return SIDEBAR_HIDDEN_TABS.has(tab as AppTab);
}

/**
 * ¿El tab debe renderizarse como módulo en el sidebar principal para el rol?
 * Requiere acceso RBAC real (canAccessTab) y que NO sea un módulo oculto.
 */
export function isVisibleInSidebar(role: UserRole, tab: string): boolean {
  return canAccessTab(role, tab) && !isSidebarHiddenTab(tab);
}

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
  'inventory-sync': 'Inventory Sync (RO)',
  provisioning: 'Provisioning Center',
  gis: 'GIS & Cobertura',
  owner: 'Owner & Automatizaciones',
  'manual-safe-mode': 'Modo Seguro Manual',
  'safe-command-queue': 'Cola de Comandos (Dry-Run)',
  'routeros-readonly': 'RouterOS Read-Only Lab',
  automation: 'Automation Center',
  'user-manual': 'Manual de Usuario',
};

export const getModuleLabel = (tab: string): string => MODULE_LABELS[tab as AppTab] || tab;

// ====================================================================
// Client 360 — capacidades de ACCIONES RÁPIDAS por rol (Fase Client 360).
//
// Distinto de la visibilidad de módulos (canAccessTab): esto decide qué
// acciones rápidas ve un operador sobre un cliente en la lista/panel CRM.
// Todas las acciones del frontend son navegación / apertura de modal /
// simulación local segura. NO ejecutan RouterOS ni cambios reales peligrosos.
// ====================================================================
export interface ClientActionCaps {
  viewProfile: boolean;       // Ver perfil (Cliente 360)
  editClient: boolean;        // Editar cliente
  suspend: boolean;           // Suspender servicio (simulación local)
  reactivate: boolean;        // Reactivar servicio (simulación local)
  changePlan: boolean;        // Cambiar plan
  changeIp: boolean;          // Cambiar IP (valida duplicado local)
  registerPayment: boolean;   // Registrar pago (mock/local)
  generateInvoice: boolean;   // Generar factura (pendiente integración)
  accountStatement: boolean;  // Estado de cuenta
  createTicket: boolean;      // Crear ticket (mock/local)
  viewTickets: boolean;       // Ver tickets
  viewRouter: boolean;        // Ver router
  viewLocation: boolean;      // Ver ubicación (mapa)
  copyIp: boolean;            // Copiar IP
  viewHistory: boolean;       // Ver eventos / historial
}

const NO_CLIENT_ACTIONS: ClientActionCaps = {
  viewProfile: false, editClient: false, suspend: false, reactivate: false,
  changePlan: false, changeIp: false, registerPayment: false, generateInvoice: false,
  accountStatement: false, createTicket: false, viewTickets: false, viewRouter: false,
  viewLocation: false, copyIp: false, viewHistory: false,
};

/**
 * Capacidades de acciones rápidas de cliente por rol. Las mutaciones reales
 * (factura, plan) son "pendiente de integración"; suspender/reactivar son
 * simulación local. Ningún rol ejecuta acciones reales sobre routers.
 */
export function clientActionCaps(role: UserRole): ClientActionCaps {
  switch (role) {
    case 'Super Admin':
    case 'Administrador':
      return {
        viewProfile: true, editClient: true, suspend: true, reactivate: true,
        changePlan: true, changeIp: true, registerPayment: true, generateInvoice: true,
        accountStatement: true, createTicket: true, viewTickets: true, viewRouter: true,
        viewLocation: true, copyIp: true, viewHistory: true,
      };
    case 'Técnico':
      return {
        ...NO_CLIENT_ACTIONS,
        viewProfile: true, editClient: true, changeIp: true,
        createTicket: true, viewTickets: true, viewRouter: true,
        viewLocation: true, copyIp: true, viewHistory: true,
      };
    case 'Soporte':
      return {
        ...NO_CLIENT_ACTIONS,
        viewProfile: true, createTicket: true, viewTickets: true,
        viewLocation: true, copyIp: true, viewHistory: true,
      };
    case 'Cobranza':
      return {
        ...NO_CLIENT_ACTIONS,
        viewProfile: true, registerPayment: true, accountStatement: true,
        viewHistory: true,
      };
    case 'Solo lectura':
      return {
        ...NO_CLIENT_ACTIONS,
        viewProfile: true, viewLocation: true, copyIp: true, viewHistory: true,
      };
    default:
      // Rol desconocido → solo lectura mínima (perfil + historial).
      return { ...NO_CLIENT_ACTIONS, viewProfile: true, viewHistory: true };
  }
}
