import React from 'react';
import {
  Activity,
  ShieldAlert,
  Users,
  CreditCard,
  Network,
  Terminal,
  Wrench,
  Box,
  Map,
  Cpu,
  Shield,
  DollarSign,
  Ban,
  FileCode,
  BookOpen,
  Wifi,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Banknote,
  ShieldCheck,
  ListChecks,
  Server
} from 'lucide-react';
import { UserSessionProfile } from '../lib/supabase';
import { canAccessTab } from '../lib/rbac';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeAlertsCount: number;
  activeTicketsCount: number;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  isOpen?: boolean;
  onClose?: () => void;
  userProfile?: UserSessionProfile | null;
  onLogout?: () => void;
}

type MenuItem = {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
};

type MenuSection = {
  id: string;
  title: string;
  items: MenuItem[];
};

export default function Sidebar({
  activeTab,
  setActiveTab,
  activeAlertsCount,
  activeTicketsCount,
  collapsed = false,
  onToggleCollapsed,
  isOpen = false,
  onClose,
  userProfile,
  onLogout
}: SidebarProps) {
  // Reorganización UX (pre PROD-4): los módulos se agrupan por dominio operativo
  // en 6 secciones. No se crean ni eliminan módulos; solo se reordena la
  // navegación. Los badges de estado de cada módulo (NEW, DRY RUN, SAFE MODE,
  // READ ONLY LAB) se muestran DENTRO de su propio módulo, no aquí en el sidebar.
  const menuSections: MenuSection[] = [
    {
      id: 'dashboard',
      title: 'Dashboard',
      items: [
        { id: 'dashboard', name: 'Dashboard', icon: Activity },
        { id: 'noc', name: 'NOC', icon: ShieldAlert },
      ],
    },
    {
      id: 'clientes',
      title: 'Clientes',
      items: [
        { id: 'crm', name: 'Subscribers', icon: Users },
        { id: 'billing', name: 'Plans & Billing', icon: CreditCard },
        { id: 'payments', name: 'Payments', icon: Banknote },
        { id: 'suspension', name: 'Suspensions', icon: Ban },
        { id: 'support', name: 'Tickets', icon: Wrench },
      ],
    },
    {
      id: 'red',
      title: 'Red',
      items: [
        { id: 'network', name: 'Network', icon: Network },
        { id: 'gis', name: 'Infrastructure', icon: Map },
        { id: 'inventory', name: 'Inventory', icon: Box },
        { id: 'inventory-routers', name: 'Routers', icon: Cpu },
        { id: 'wireguard', name: 'WireGuard', icon: Shield },
      ],
    },
    {
      id: 'mikrotik-workspace',
      title: 'MikroTik Workspace',
      items: [
        { id: 'mikrotik', name: 'MikroTik Core', icon: Terminal },
        { id: 'router-enrollment', name: 'Router Enrollment', icon: Wifi },
        { id: 'routeros-templates', name: 'Router Templates', icon: BookOpen },
        { id: 'routeros-resources', name: 'Router Scripts', icon: FileCode },
        { id: 'routeros-readonly', name: 'RouterOS Lab', icon: Server },
        { id: 'manual-safe-mode', name: 'Manual Safe Mode', icon: ShieldCheck },
        { id: 'safe-command-queue', name: 'Safe Command Queue', icon: ListChecks },
      ],
    },
    {
      id: 'operaciones',
      title: 'Operaciones',
      items: [
        { id: 'finance', name: 'Analytics', icon: DollarSign },
      ],
    },
    {
      id: 'administracion',
      title: 'Administración',
      items: [
        { id: 'owner', name: 'Settings', icon: Shield },
      ],
    },
  ];

  // Filtering views according to basic Role Perms (FASE 1 Requirement)
  const isAuthorizedTab = (tabId: string): boolean => {
    if (!userProfile) return false;
    return canAccessTab(userProfile.role, tabId);
  };

  const filteredSections = menuSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => isAuthorizedTab(item.id))
    }))
    .filter(section => section.items.length > 0);

  return (
    <>
      {/* Mobile backdrop overlay only when open */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        id="sidebar-container"
        className={`fixed md:sticky top-0 left-0 h-screen w-72 ${collapsed ? 'md:w-14' : 'md:w-72'} bg-slate-950 border-r border-slate-800 flex flex-col justify-between text-slate-100 font-sans transition-[width,transform] duration-300 z-50 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className={`${collapsed ? 'p-3' : 'p-6'} flex-1 overflow-y-auto flex flex-col justify-between`}>
          <div>
            {/* Brand header */}
            <div className={`relative flex items-center ${collapsed ? 'justify-center mb-6' : 'justify-between mb-8'}`}>
              <div className={`flex items-center ${collapsed ? '' : 'space-x-3'}`}>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Cpu className="w-6 h-6 text-white" />
                </div>
                {!collapsed && (
                  <div>
                    <h1 className="text-xl font-bold tracking-tight text-white flex items-center">
                      Nuga<span className="text-indigo-400 font-semibold text-lg">Core</span>
                    </h1>
                    <p className="text-[10px] text-slate-400 font-mono tracking-wider">WISP & FTTH ERP v2.4</p>
                  </div>
                )}
              </div>

              {!collapsed && (
                <div className="flex items-center space-x-1">
                  {onToggleCollapsed && (
                    <button
                      type="button"
                      onClick={onToggleCollapsed}
                      className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition"
                      title="Colapsar barra lateral"
                      aria-label="Colapsar barra lateral"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}

                  {/* Mobile close button */}
                  {onClose && (
                    <button
                      onClick={onClose}
                      className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition"
                      title="Cerrar menú"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              )}

              {collapsed && onToggleCollapsed && (
                <button
                  type="button"
                  onClick={onToggleCollapsed}
                  className="hidden md:flex absolute top-1 right-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 transition"
                  title="Expandir barra lateral"
                  aria-label="Expandir barra lateral"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Navigation list */}
            <nav className={collapsed ? 'space-y-2' : 'space-y-4'}>
              {!collapsed && (
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold px-3 mb-2 font-mono">Módulos Habilitados</p>
              )}
              {filteredSections.map(section => (
                <div key={section.id} className={collapsed ? 'space-y-1' : 'space-y-1.5'}>
                  {!collapsed && (
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold px-3 font-mono">
                      {section.title}
                    </p>
                  )}
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    const hasNetworkAlerts = item.id === 'network' && activeAlertsCount > 0;
                    const hasOpenTickets = item.id === 'support' && activeTicketsCount > 0;
                    const hasIndicators = hasNetworkAlerts || hasOpenTickets;

                    return (
                      <button
                        key={item.id}
                        id={`sidebar-tab-${item.id}`}
                        onClick={() => {
                          setActiveTab(item.id);
                          if (onClose) onClose();
                        }}
                        title={collapsed ? item.name : undefined}
                        aria-label={item.name}
                        className={`w-full flex items-center ${collapsed ? 'justify-center px-2.5 py-2.5' : 'justify-between px-3.5 py-2.5 text-sm'} rounded-lg transition-all duration-200 group text-left ${
                          isActive
                            ? 'bg-indigo-600/15 border border-indigo-500/30 text-white font-medium shadow-sm'
                            : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent'
                        }`}
                      >
                        <div className={`flex items-center ${collapsed ? '' : 'space-x-3 min-w-0'}`}>
                          <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 shrink-0 ${
                            isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                          }`} />
                          {!collapsed && <span className="truncate">{item.name}</span>}
                        </div>

                        {!collapsed && hasIndicators && (
                          <div className="flex items-center space-x-1.5 shrink-0">
                            {hasNetworkAlerts && (
                              <span className="bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                                {activeAlertsCount}
                              </span>
                            )}
                            {hasOpenTickets && (
                              <span className="bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                                {activeTicketsCount}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>

          {/* Operator Profile Summary Card inside sidebar boundary */}
          {userProfile && (
            <div className={`${collapsed ? 'mt-6 pt-4' : 'mt-8 pt-5'} border-t border-slate-900/90 space-y-3.5`}>
              <div className={`bg-slate-950/80 border border-slate-900 rounded-2xl ${collapsed ? 'p-2.5 flex justify-center' : 'p-3 flex items-center space-x-3'}`}>
                {userProfile.avatar_url ? (
                  <img
                    src={userProfile.avatar_url}
                    alt={userProfile.full_name}
                    className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-800"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-indigo-950 border border-indigo-900 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0 uppercase">
                    {userProfile.full_name.substring(0, 2)}
                  </div>
                )}
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <h4 className="text-xs font-bold text-slate-200 truncate leading-tight flex items-center space-x-1">
                      <span>{userProfile.full_name}</span>
                    </h4>
                    <p className="text-[10px] text-slate-500 truncate font-mono mt-0.5">{userProfile.email}</p>

                    {/* Dynamic Role Badge */}
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-bold mt-1.5 ${
                      userProfile.role === 'Super Admin' ? 'bg-indigo-950 text-indigo-400 border border-indigo-900' :
                      userProfile.role === 'Administrador' ? 'bg-sky-950 text-sky-400 border border-sky-900' :
                      userProfile.role === 'Cobranza' ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' :
                      userProfile.role === 'Técnico' ? 'bg-amber-950 text-amber-400 border border-amber-900' :
                      'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}>
                      {userProfile.role}
                    </span>
                  </div>
                )}
              </div>

              {/* Redesigned Logout button */}
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className={`w-full py-2 ${collapsed ? 'px-2' : 'px-3'} border border-slate-900 hover:border-rose-950/40 hover:bg-rose-950/20 text-slate-400 hover:text-rose-400 text-xs font-semibold rounded-xl transition flex items-center justify-center ${collapsed ? '' : 'space-x-2'} font-mono group`}
                  title="Cerrar sesión"
                  aria-label="Cerrar sesión"
                >
                  <LogOut className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
                  {!collapsed && <span>Salir del Sistema</span>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className={`border-t border-slate-900 bg-slate-950/60 font-mono text-[11px] text-slate-500 shrink-0 ${collapsed ? 'p-2.5' : 'p-4 space-y-1'}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
            <span className={`flex items-center ${collapsed ? '' : 'space-x-1.5'} text-emerald-400`}>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              {!collapsed && <span className="font-semibold text-[10px] uppercase">Noc Core Live</span>}
            </span>
            {!collapsed && <span className="text-slate-400">v7.14 RouterOS</span>}
          </div>
          {!collapsed && <p className="text-[10px] text-slate-600 truncate">Sincronizado: Acapulco & CDMX</p>}
        </div>
      </aside>
    </>
  );
}
