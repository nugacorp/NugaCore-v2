import React, { useState } from 'react';
import {
  Activity,
  ShieldAlert,
  Users,
  CreditCard,
  Network,
  Wrench,
  Box,
  Map,
  Cpu,
  Shield,
  Ban,
  BookOpen,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Banknote,
  BookText,
  ClipboardList,
  Bell,
  TrendingUp,
  Globe,
  Smartphone,
  DollarSign,
  LayoutDashboard,
  Settings,
} from 'lucide-react';
import { UserSessionProfile } from '../lib/supabase';
import { isVisibleInSidebar } from '../lib/rbac';

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
  icon: React.ComponentType<{ className?: string }>;
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
  // Reorganización UX WISP LATAM (referencia WispHub): categorías desplegables
  // para no saturar al operador. routers MikroTik viven en Sistema → Routers.
  // Módulos avanzados siguen ocultos via isVisibleInSidebar (rbac.ts).
  const menuSections: MenuSection[] = [
    {
      id: 'inicio',
      title: 'Inicio',
      icon: LayoutDashboard,
      items: [
        { id: 'dashboard', name: 'Dashboard', icon: Activity },
        { id: 'reports', name: 'Reportes', icon: ClipboardList },
      ],
    },
    {
      id: 'clientes',
      title: 'Clientes',
      icon: Users,
      items: [
        { id: 'crm', name: 'Clientes', icon: Users },
        { id: 'commercial', name: 'Prospectos', icon: TrendingUp },
        { id: 'portal', name: 'Portal Cliente', icon: Globe },
        { id: 'support', name: 'Tickets', icon: Wrench },
        { id: 'tech-pwa', name: 'App Técnicos', icon: Smartphone },
      ],
    },
    {
      id: 'facturacion',
      title: 'Facturación',
      icon: CreditCard,
      items: [
        { id: 'billing', name: 'Planes y Facturación', icon: CreditCard },
        { id: 'payments', name: 'Pagos', icon: Banknote },
        { id: 'suspension', name: 'Suspensiones', icon: Ban },
        { id: 'finance', name: 'Finanzas', icon: DollarSign },
      ],
    },
    {
      id: 'red',
      title: 'Red',
      icon: Network,
      items: [
        { id: 'noc', name: 'NOC', icon: ShieldAlert },
        { id: 'gis', name: 'Mapa de Red', icon: Map },
        { id: 'network', name: 'Torres y Sitios', icon: Network },
      ],
    },
    {
      id: 'operaciones',
      title: 'Operaciones',
      icon: Box,
      items: [
        { id: 'inventory', name: 'Inventario', icon: Box },
      ],
    },
    {
      id: 'sistema',
      title: 'Sistema',
      icon: Settings,
      items: [
        { id: 'inventory-routers', name: 'Routers', icon: Cpu },
        { id: 'routeros-templates', name: 'Plantillas', icon: BookOpen },
        { id: 'owner', name: 'Configuración', icon: Shield },
        { id: 'notifications', name: 'Notificaciones', icon: Bell },
        { id: 'user-manual', name: 'Manual de Usuario', icon: BookText },
      ],
    },
  ];

  const isAuthorizedTab = (tabId: string): boolean => {
    if (!userProfile) return false;
    return isVisibleInSidebar(userProfile.role, tabId);
  };

  const filteredSections = menuSections
    .map(section => ({
      ...section,
      items: section.items.filter(item => isAuthorizedTab(item.id))
    }))
    .filter(section => section.items.length > 0);

  const sectionIdForTab = (tabId: string): string | null =>
    filteredSections.find((section) => section.items.some((item) => item.id === tabId))?.id ?? null;

  // Acordeón: una categoría abierta. Sigue al tab activo; el operador puede
  // abrir/cerrar otras sin perder el contexto del módulo actual.
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [lastActiveTab, setLastActiveTab] = useState(activeTab);
  const preferredSectionId = sectionIdForTab(activeTab) ?? filteredSections[0]?.id ?? null;

  // Sincroniza acordeón con tab activo / login (cuando aparecen secciones).
  if (activeTab !== lastActiveTab) {
    setLastActiveTab(activeTab);
    if (preferredSectionId) setOpenSectionId(preferredSectionId);
  } else if (openSectionId === null && preferredSectionId) {
    setOpenSectionId(preferredSectionId);
  } else if (
    openSectionId !== null &&
    preferredSectionId &&
    !filteredSections.some((section) => section.id === openSectionId)
  ) {
    setOpenSectionId(preferredSectionId);
  }

  const toggleSection = (sectionId: string) => {
    setOpenSectionId((prev) => (prev === sectionId ? null : sectionId));
  };

  const sectionAlertCount = (section: MenuSection): number => {
    let count = 0;
    if (section.items.some((item) => item.id === 'noc')) count += activeAlertsCount;
    if (section.items.some((item) => item.id === 'support')) count += activeTicketsCount;
    return count;
  };

  return (
    <>
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

            <nav className={collapsed ? 'space-y-2' : 'space-y-1'} aria-label="Navegación principal">
              {!collapsed && (
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold px-3 mb-3 font-mono">
                  Menú
                </p>
              )}
              {filteredSections.map((section) => {
                const SectionIcon = section.icon;
                const hasActiveItem = section.items.some((item) => item.id === activeTab);
                const isSectionOpen = collapsed || openSectionId === section.id;
                const alerts = sectionAlertCount(section);

                if (collapsed) {
                  return (
                    <div key={section.id} className="space-y-1">
                      {section.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                          <button
                            key={item.id}
                            id={`sidebar-tab-${item.id}`}
                            type="button"
                            onClick={() => {
                              setActiveTab(item.id);
                              if (onClose) onClose();
                            }}
                            title={item.name}
                            aria-label={item.name}
                            className={`w-full flex items-center justify-center px-2.5 py-2.5 rounded-lg transition-all duration-200 group ${
                              isActive
                                ? 'bg-indigo-600/15 border border-indigo-500/30 text-white shadow-sm'
                                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent'
                            }`}
                          >
                            <Icon
                              className={`w-4 h-4 shrink-0 ${
                                isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div key={section.id} className="rounded-lg">
                    <button
                      type="button"
                      id={`sidebar-section-${section.id}`}
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={isSectionOpen}
                      aria-controls={`sidebar-section-panel-${section.id}`}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors duration-200 group ${
                        hasActiveItem
                          ? 'bg-slate-900/80 text-white border border-slate-700/80'
                          : 'text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <SectionIcon
                          className={`w-4 h-4 shrink-0 ${
                            hasActiveItem ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
                          }`}
                        />
                        <span className="font-medium truncate">{section.title}</span>
                        {alerts > 0 && (
                          <span className="bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] px-1.5 py-0.5 rounded-full font-mono">
                            {alerts}
                          </span>
                        )}
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 text-slate-500 transition-transform duration-200 ${
                          isSectionOpen ? 'rotate-180 text-emerald-400' : ''
                        }`}
                      />
                    </button>

                    <div
                      id={`sidebar-section-panel-${section.id}`}
                      role="region"
                      aria-labelledby={`sidebar-section-${section.id}`}
                      className={`overflow-hidden transition-[grid-template-rows] duration-200 ease-out grid ${
                        isSectionOpen ? 'grid-rows-[1fr] mt-1' : 'grid-rows-[0fr]'
                      }`}
                    >
                      <div className="min-h-0 space-y-0.5 pl-2">
                        {section.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = activeTab === item.id;
                          const hasNocAlerts = item.id === 'noc' && activeAlertsCount > 0;
                          const hasOpenTickets = item.id === 'support' && activeTicketsCount > 0;
                          const hasIndicators = hasNocAlerts || hasOpenTickets;

                          return (
                            <button
                              key={item.id}
                              id={`sidebar-tab-${item.id}`}
                              type="button"
                              onClick={() => {
                                setActiveTab(item.id);
                                setOpenSectionId(section.id);
                                if (onClose) onClose();
                              }}
                              aria-label={item.name}
                              className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-all duration-200 group text-left ${
                                isActive
                                  ? 'bg-indigo-600/15 border border-indigo-500/30 text-white font-medium shadow-sm'
                                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent'
                              }`}
                            >
                              <div className="flex items-center space-x-3 min-w-0">
                                <Icon
                                  className={`w-3.5 h-3.5 transition-transform group-hover:scale-110 shrink-0 ${
                                    isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                                  }`}
                                />
                                <span className="truncate">{item.name}</span>
                              </div>

                              {hasIndicators && (
                                <div className="flex items-center space-x-1.5 shrink-0">
                                  {hasNocAlerts && (
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
                    </div>
                  </div>
                );
              })}
            </nav>
          </div>

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

        <div className={`border-t border-slate-900 bg-slate-950/60 font-mono text-[11px] text-slate-500 shrink-0 ${collapsed ? 'p-2.5' : 'p-4 space-y-1'}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
            <span className={`flex items-center ${collapsed ? '' : 'space-x-1.5'} text-emerald-400`}>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              {!collapsed && <span className="font-semibold text-[10px] uppercase">NugaCore</span>}
            </span>
            {!collapsed && <span className="text-slate-400">datos reales</span>}
          </div>
          {!collapsed && (
            <p className="text-[10px] text-slate-600 truncate">
              Sin demos: inventario y NOC desde backend / routers dados de alta
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
