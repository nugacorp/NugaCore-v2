import React from 'react';
import { 
  Activity, 
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
  X
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  activeAlertsCount: number;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ 
  activeTab, 
  setActiveTab, 
  activeAlertsCount,
  isOpen = false,
  onClose
}: SidebarProps) {
  const menuItems = [
    { id: 'dashboard', name: 'Dashboard Ejecutivo', icon: Activity },
    { id: 'crm', name: 'CRM Clientes & Leads', icon: Users },
    { id: 'billing', name: 'Facturación & Cobros', icon: CreditCard },
    { id: 'finance', name: 'Finanzas & EBITDA', icon: DollarSign },
    { id: 'network', name: 'Red WISP & FTTH', icon: Network },
    { id: 'mikrotik', name: 'MikroTik Core Control & Copilot', icon: Terminal, highlight: true },
    { id: 'support', name: 'Remesa Soporte & OT', icon: Wrench },
    { id: 'inventory', name: 'Inventarios / ERP', icon: Box },
    { id: 'gis', name: 'GIS & Cobertura Co-Map', icon: Map },
    { id: 'owner', name: 'Owner & Automatizaciones', icon: Shield },
  ];

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
        <div className="p-6 flex-1 overflow-y-auto">
          {/* Brand header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-sky-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Cpu className="w-6 h-6 text-white animate-pulse" />
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
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold px-3 mb-2 font-mono">Módulos Núcleo</p>
            {menuItems.map((item) => {
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
