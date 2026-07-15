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
  | 'notifications'
  | 'commercial'
  | 'reports'
  | 'portal'
  | 'tech-pwa'
  | 'user-manual';

// ====================================================================
// RBAC visual: qué módulos (tabs) ve cada rol. Mapeado a los tabs
// EXISTENTES (no se crean módulos nuevos). Las distinciones de "lectura"
// se aplican por RBAC del backend en las escrituras; aquí solo se decide
// la VISIBILIDAD del módulo.
// ====================================================================
const roleTabs: Record<UserRole, AppTab[]> = {
  'Super Admin':  ['dashboard', 'noc', 'crm', 'commercial', 'billing', 'finance', 'suspension', 'payments', 'network', 'mikrotik', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'tech-pwa', 'inventory', 'inventory-routers', 'gis', 'owner', 'reports', 'portal', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'notifications', 'user-manual'],
  'Administrador':['dashboard', 'noc', 'crm', 'commercial', 'billing', 'suspension', 'payments', 'network', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'tech-pwa', 'inventory', 'inventory-routers', 'gis', 'reports', 'portal', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'notifications', 'user-manual'],
  'Cobranza':     ['dashboard', 'crm', 'commercial', 'billing', 'finance', 'suspension', 'payments', 'reports', 'portal', 'provisioning', 'notifications', 'user-manual'],
  'Técnico':      ['dashboard', 'noc', 'crm', 'suspension', 'network', 'mikrotik', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'support', 'tech-pwa', 'inventory', 'inventory-routers', 'gis', 'portal', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'notifications', 'user-manual'],
  'Soporte':      ['dashboard', 'noc', 'crm', 'commercial', 'support', 'tech-pwa', 'inventory-routers', 'gis', 'portal', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'notifications', 'user-manual'],
  'Solo lectura': ['dashboard', 'noc', 'crm', 'commercial', 'billing', 'suspension', 'network', 'inventory-routers', 'gis', 'reports', 'portal', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'notifications', 'user-manual'],
};

// ====================================================================
// Visibilidad en el sidebar ≠ acceso (RBAC). Algunos módulos siguen siendo
// ACCESIBLES por su rol (canAccessTab = true, acceso directo por tab/URL,
// workspace in-page o enlaces internos) pero NO se listan en el menú WISP:
//  - wireguard: infra interna; peers automáticos en Alta de Router.
//  - router-enrollment: el alta vive dentro de Sistema → Routers (botón
//    "Dar de alta"); sigue accesible por tab/workspace/RBAC.
//  - manual-safe-mode / safe-command-queue: seguridad / dry-run interno.
//  - mikrotik / routeros-resources: panel core y scripts avanzados; el flujo
//    diario usa Routers + Plantillas + workspace in-page.
//  - routeros-readonly / inventory-sync / provisioning: lab, sync y dry-run
//    de aprovisionamiento; no son módulos operativos de un WISP LATAM.
//  - automation: DRY RUN / lab interno; retirado de la UI operativa del WISP
//    (sin acceso por rol; el motor backend puede seguir existiendo).
// No se eliminan ni se les quita acceso (salvo automation): solo se ocultan del sidebar.
// ====================================================================
const SIDEBAR_HIDDEN_TABS: ReadonlySet<AppTab> = new Set<AppTab>([
  'wireguard',
  'router-enrollment',
  'manual-safe-mode',
  'safe-command-queue',
  'mikrotik',
  'routeros-resources',
  'routeros-readonly',
  'inventory-sync',
  'provisioning',
  'automation',
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
  noc: 'NOC',
  crm: 'Clientes',
  billing: 'Planes y Facturación',
  finance: 'Finanzas',
  suspension: 'Suspensiones',
  network: 'Torres y Sitios',
  mikrotik: 'Panel MikroTik',
  wireguard: 'WireGuard (interno)',
  'routeros-resources': 'Scripts RouterOS',
  'routeros-templates': 'Plantillas RouterOS',
  'router-enrollment': 'Alta de Router',
  payments: 'Pagos',
  support: 'Tickets',
  inventory: 'Inventario',
  'inventory-routers': 'Routers',
  'inventory-sync': 'Sincronización Inventario',
  provisioning: 'Centro de Aprovisionamiento',
  gis: 'Mapa de Red',
  owner: 'Configuración',
  'manual-safe-mode': 'Modo Seguro Manual',
  'safe-command-queue': 'Cola de Comandos (Dry-Run)',
  'routeros-readonly': 'Laboratorio MikroTik',
  automation: 'Automatización',
  notifications: 'Notificaciones',
  'user-manual': 'Manual de Usuario',
  commercial: 'Prospectos',
  reports: 'Reportes',
  portal: 'Portal Cliente',
  'tech-pwa': 'App Técnicos',
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
