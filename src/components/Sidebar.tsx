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
  Sparkles,
  Cpu,
  Shield,
  DollarSign,
  Ban,
  FileCode,
  BookOpen,
  Wifi,
  X,
  LogOut,
  Banknote,
  ShieldCheck,
  ListChecks
} from 'lucide-react';
import { UserSessionProfile } from '../lib/supabase';
import { canAccessTab } from '../lib/rbac';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeAlertsCount: number;
  isOpen?: boolean;
  onClose?: () => void;
  userProfile?: UserSessionProfile | null;
  onLogout?: () => void;
}

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  activeAlertsCount,
  isOpen = false,
  onClose,
  userProfile,
  onLogout
}: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', name: 'Dashboard Ejecutivo', icon: Activity },
    { id: 'noc', name: 'NOC Read-Only', icon: ShieldAlert },
    { id: 'crm', name: 'CRM Clientes & Leads', icon: Users },
    { id: 'billing', name: 'Facturación & Cobros', icon: CreditCard },
    { id: 'finance', name: 'Finanzas & EBITDA', icon: DollarSign },
    { id: 'suspension', name: 'Suspensiones & Cortes', icon: Ban },
    { id: 'network', name: 'Red WISP & FTTH', icon: Network },
    { id: 'mikrotik', name: 'MikroTik Core Control & Copilot', icon: Terminal, highlight: true },
    { id: 'wireguard', name: 'WireGuard Manager', icon: Shield },
    { id: 'routeros-resources', name: 'Recursos MikroTik (.rsc)', icon: FileCode },
    { id: 'routeros-templates', name: 'Templates RouterOS Library', icon: BookOpen },
    { id: 'router-enrollment', name: 'Enrollment WireGuard Auto', icon: Wifi },
    { id: 'payments', name: 'Portal Pagos & Reactivación', icon: Banknote },
    { id: 'support', name: 'Remesa Soporte & OT', icon: Wrench },
    { id: 'inventory', name: 'Inventarios / ERP', icon: Box },
    { id: 'inventory-routers', name: 'Inventario Routers (Read-Only)', icon: Cpu },
    { id: 'gis', name: 'GIS & Cobertura Co-Map', icon: Map },
    { id: 'owner', name: 'Owner & Automatizaciones', icon: Shield },
    { id: 'manual-safe-mode', name: 'Modo Seguro Manual (SAFE MODE)', icon: ShieldCheck },
    { id: 'safe-command-queue', name: 'Cola de Comandos (DRY RUN)', icon: ListChecks },
  ];

  // Filtering views according to basic Role Perms (FASE 1 Requirement)
  const isAuthorizedTab = (tabId: string): boolean => {
    if (!userProfile) return false;
    return canAccessTab(userProfile.role, tabId);
  };

  const filteredMenuItems = menuItems.filter(item => isAuthorizedTab(item.id));

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
        className={`fixed md:sticky top-0 left-0 h-screen w-72 bg-slate-950 border-r border-slate-800 flex flex-col justify-between text-slate-100 font-sans transition-transform duration-300 z-50 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-6 flex-1 overflow-y-auto flex flex-col justify-between">
          <div>
            {/* Brand header */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Cpu className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-white flex items-center">
                    Nuga<span className="text-indigo-400 font-semibold text-lg">Core</span>
                  </h1>
                  <p className="text-[10px] text-slate-400 font-mono tracking-wider">WISP & FTTH ERP v2.4</p>
                </div>
              </div>

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

            {/* Navigation list */}
            <nav className="space-y-1.5">
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold px-3 mb-2 font-mono">Módulos Habilitados</p>
              {filteredMenuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    id={`sidebar-tab-${item.id}`}
                    onClick={() => {
                      setActiveTab(item.id);
                      if (onClose) onClose();
                    }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm transition-all duration-200 group text-left ${
                      isActive
                        ? 'bg-indigo-600/15 border border-indigo-500/30 text-white font-medium shadow-sm'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                        isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                      }`} />
                      <span className="truncate">{item.name}</span>
                    </div>
                    {item.highlight && (
                      <Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse shrink-0" />
                    )}
                    {item.id === 'network' && activeAlertsCount > 0 && (
                      <span className="bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0">
                        {activeAlertsCount} Alert
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Operator Profile Summary Card inside sidebar boundary */}
          {userProfile && (
            <div className="mt-8 pt-5 border-t border-slate-900/90 space-y-3.5">
              <div className="bg-slate-950/80 border border-slate-900 rounded-2xl p-3 flex items-center space-x-3">
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
              </div>

              {/* Redesigned Logout button */}
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full py-2 px-3 border border-slate-900 hover:border-rose-950/40 hover:bg-rose-950/20 text-slate-400 hover:text-rose-400 text-xs font-semibold rounded-xl transition flex items-center justify-center space-x-2 font-mono group"
                  title="Cerrar sesión"
                >
                  <LogOut className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-0.5" />
                  <span>Salir del Sistema</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="p-4 border-t border-slate-900 bg-slate-950/60 font-mono text-[11px] text-slate-500 space-y-1 shrink-0">
          <div className="flex items-center justify-between">
            <span className="flex items-center space-x-1.5 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              <span className="font-semibold text-[10px] uppercase">Noc Core Live</span>
            </span>
            <span className="text-slate-400">v7.14 RouterOS</span>
          </div>
          <p className="text-[10px] text-slate-600 truncate">Sincronizado: Acapulco & CDMX</p>
        </div>
      </aside>
    </>
  );
}
