import React, { useState, useEffect, useCallback } from 'react';
import { createAuthorizedApi } from '../lib/apiClient';
import {
  Boxes,
  RefreshCw,
  Lock,
  Wifi,
  KeyRound,
  AlertTriangle,
  ServerCrash,
  Server,
  Plus,
} from 'lucide-react';
import type { UserRole } from '../lib/supabase';
import { canStartEnrollment } from '../lib/enrollmentRbac';
import RouterEnrollmentWizard from './RouterEnrollmentWizard';

// ====================================================================
// Inventario de routers MikroTik + alta embebida.
//
// Vista del inventario (`mikrotik_routers`) y botón "Dar de alta" que abre
// el flujo existente de enrollment (RouterEnrollmentWizard), sin sección
// separada en el sidebar.
// ====================================================================

type RouterOnlineStatus = 'online' | 'offline';
type RouterProvisioningStatus = 'pending' | 'provisioned' | 'connected' | 'error';
export type RoutersPanel = 'inventory' | 'enrollment';

interface InventoryRouterView {
  id: string;
  name: string;
  status: RouterOnlineStatus;
  isOnline: boolean;
  provisioningStatus: RouterProvisioningStatus;
  connectionType: string;
  managementIp?: string;
  vpnIp?: string;
  apiPort: number;
  apiSslPort?: number;
  routerOsVersion?: string;
  towerId?: string;
  hasCredentials: boolean;
  cpuUsagePct: number;
  memoryUsagePct: number;
  lastSeenAt?: string;
  lastHealthCheckAt?: string;
  notes?: string;
}

interface InventorySummary {
  totalRouters: number;
  onlineRouters: number;
  offlineRouters: number;
  provisionedRouters: number;
  pendingRouters: number;
  routersWithVpn: number;
  routersWithCredentials: number;
  lastSeenCount: number;
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
  userRole: UserRole;
  /** Panel activo controlado por App (inventario vs alta). */
  panel: RoutersPanel;
  onPanelChange: (panel: RoutersPanel) => void;
}

const PROV_BADGE: Record<RouterProvisioningStatus, string> = {
  connected: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  provisioned: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  error: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

const dash = (value?: string): string => (value && value.trim() !== '' ? value : '—');

export default function InventoryRoutersModule({
  getAuthHeaders,
  userRole,
  panel,
  onPanelChange,
}: Props) {
  const [routers, setRouters] = useState<InventoryRouterView[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const canEnroll = canStartEnrollment(userRole);
  const showEnrollment = panel === 'enrollment' && canEnroll;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const [summaryData, routersData] = await Promise.all([
        api.get<InventorySummary>('/api/inventory/summary'),
        api.get<InventoryRouterView[]>('/api/inventory/routers'),
      ]);
      setSummary(summaryData);
      setRouters(routersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar el inventario.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (showEnrollment) return;
    void load();
  }, [load, showEnrollment]);

  if (showEnrollment) {
    return (
      <RouterEnrollmentWizard
        userRole={userRole}
        getAuthHeaders={getAuthHeaders}
        startInWizard
        onBack={() => onPanelChange('inventory')}
      />
    );
  }

  const summaryCards: { label: string; value: number; icon: React.ElementType }[] = summary
    ? [
        { label: 'Total', value: summary.totalRouters, icon: Boxes },
        { label: 'Online', value: summary.onlineRouters, icon: Server },
        { label: 'Offline', value: summary.offlineRouters, icon: ServerCrash },
        { label: 'Aprovisionados', value: summary.provisionedRouters, icon: Server },
        { label: 'Pendientes', value: summary.pendingRouters, icon: AlertTriangle },
        { label: 'Con VPN', value: summary.routersWithVpn, icon: Wifi },
        { label: 'Con credenciales', value: summary.routersWithCredentials, icon: KeyRound },
        { label: 'Vistos (last seen)', value: summary.lastSeenCount, icon: Server },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-full text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Boxes className="w-6 h-6 text-indigo-400" />
            <span>Routers</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Inventario de routers MikroTik. Usa <span className="text-indigo-300">Dar de alta</span> para
            incorporar un equipo nuevo.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 font-mono">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>INVENTARIO</span>
          </span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center space-x-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-300 hover:bg-slate-850 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
          {canEnroll && (
            <button
              type="button"
              id="routers-dar-de-alta-btn"
              onClick={() => onPanelChange('enrollment')}
              className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-sm font-medium text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Dar de alta</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryCards.map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center space-x-2 text-slate-400 text-xs">
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </div>
              <p className="text-2xl font-bold text-white mt-1">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabla / empty state */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Cargando inventario...
          </div>
        ) : routers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-500">
            <Boxes className="w-10 h-10 mb-3 text-slate-700" />
            <p className="font-medium text-slate-400">No hay routers en el inventario</p>
            <p className="text-xs mt-1">Da de alta un router para que aparezca aquí tras generar el script.</p>
            {canEnroll && (
              <button
                type="button"
                onClick={() => onPanelChange('enrollment')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-sm font-medium text-white"
              >
                <Plus className="w-4 h-4" />
                Dar de alta
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Nombre</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Provisioning</th>
                  <th className="text-left px-4 py-3 font-medium">Conexión</th>
                  <th className="text-left px-4 py-3 font-medium">IP gestión</th>
                  <th className="text-left px-4 py-3 font-medium">IP VPN</th>
                  <th className="text-left px-4 py-3 font-medium">API</th>
                  <th className="text-left px-4 py-3 font-medium">RouterOS</th>
                  <th className="text-left px-4 py-3 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {routers.map((router) => (
                  <tr key={router.id} className="hover:bg-slate-850/40">
                    <td className="px-4 py-3 font-medium text-slate-200">{router.name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center space-x-1.5 ${
                          router.isOnline ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            router.isOnline ? 'bg-emerald-500' : 'bg-slate-600'
                          }`}
                        />
                        <span>{router.status}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs border ${PROV_BADGE[router.provisioningStatus]}`}
                      >
                        {router.provisioningStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{router.connectionType}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.managementIp)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.vpnIp)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{router.apiPort}</td>
                    <td className="px-4 py-3 text-slate-300">{dash(router.routerOsVersion)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{dash(router.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600">
        El inventario es de consulta. El alta de routers abre el asistente de enrollment existente.
      </p>
    </div>
  );
}
