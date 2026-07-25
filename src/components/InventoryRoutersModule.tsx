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
  Trash2,
  CheckCircle,
  Wrench,
  Download,
} from 'lucide-react';
import type { UserRole } from '../lib/supabase';
import { canStartEnrollment, canRevokeEnrollment } from '../lib/enrollmentRbac';
import RouterOnboardingWizard from './RouterOnboardingWizard';

// ====================================================================
// Inventario de routers MikroTik + alta embebida.
//
// Vista del inventario (`mikrotik_routers`) y botón "Dar de alta" que abre
// el flujo completo de onboarding (RouterOnboardingWizard), sin sección
// separada en el sidebar. Acciones: verificar online / eliminar (limpia
// enrollment + peer WG + fila de inventario).
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

interface EnrollmentListItem {
  id: string;
  routerId: string;
  status: string;
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

const PROV_LABEL: Record<RouterProvisioningStatus, string> = {
  connected: 'conectado',
  provisioned: 'aprovisionado',
  pending: 'pendiente',
  error: 'error',
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
  const [enrollmentByRouter, setEnrollmentByRouter] = useState<Record<string, EnrollmentListItem>>({});
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string>('');
  const [actionLabel, setActionLabel] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [info, setInfo] = useState<string>('');

  const canEnroll = canStartEnrollment(userRole);
  const canDelete = canRevokeEnrollment(userRole);
  const showEnrollment = panel === 'enrollment' && canEnroll;

  /** Recarga inventario. Por defecto NO borra mensajes de Verificar/Reparar. */
  const load = useCallback(async (opts?: { clearMessages?: boolean; quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    if (opts?.clearMessages) {
      setError('');
      setInfo('');
    }
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const [summaryData, routersData] = await Promise.all([
        api.get<InventorySummary>('/api/inventory/summary'),
        api.get<InventoryRouterView[]>('/api/inventory/routers'),
      ]);
      setSummary(summaryData);
      setRouters(routersData);

      if (canEnroll || canDelete) {
        try {
          const enrollments = await api.get<EnrollmentListItem[]>('/api/router-enrollment');
          const map: Record<string, EnrollmentListItem> = {};
          for (const enr of enrollments) {
            if (!enr.routerId) continue;
            // Preferir enrollment no revocado si hay varios.
            if (!map[enr.routerId] || enr.status !== 'revoked') {
              map[enr.routerId] = enr;
            }
          }
          setEnrollmentByRouter(map);
        } catch {
          setEnrollmentByRouter({});
        }
      } else {
        setEnrollmentByRouter({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar el inventario.');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, [getAuthHeaders, canEnroll, canDelete]);

  useEffect(() => {
    if (showEnrollment) return;
    void load();
  }, [load, showEnrollment]);

  const handleCheckOnline = async (router: InventoryRouterView) => {
    const enrollment = enrollmentByRouter[router.id];
    if (!enrollment || enrollment.status === 'revoked') {
      setInfo('');
      setError('No hay alta vinculada a este router. Usa Dar de alta o descarga el .rsc desde el asistente.');
      return;
    }
    setActionId(router.id);
    setActionLabel(`Verificando ${router.name} vía API (puerto ${router.apiPort})…`);
    setError('');
    setInfo('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const data = await api.post<{
        isOnline?: boolean;
        message?: string;
        snapshotSource?: string | null;
        apiTcpReachable?: boolean | null;
        repairHint?: string | null;
        liveError?: string | null;
      }>(`/api/router-enrollment/${enrollment.id}/check-online`);
      // Refrescar tabla SIN borrar el mensaje (bug: load() limpiaba setError).
      await load({ quiet: true });
      if (data.isOnline) {
        setError('');
        setInfo(data.message || `Router ${router.name} online (${data.snapshotSource ?? 'live'}).`);
      } else {
        const detail = [
          data.message,
          data.apiTcpReachable === true ? 'VPN/TCP API: reachable' : data.apiTcpReachable === false ? 'VPN/TCP API: no responde' : null,
          data.liveError ? `Detalle: ${data.liveError}` : null,
          data.repairHint,
        ]
          .filter(Boolean)
          .join(' — ');
        setInfo('');
        setError(detail || `Router ${router.name} aún no responde vía API.`);
      }
    } catch (err) {
      setInfo('');
      setError(err instanceof Error ? err.message : 'No se pudo verificar online.');
    } finally {
      setActionId('');
      setActionLabel('');
    }
  };

  const handleRepairApi = async (router: InventoryRouterView) => {
    const enrollment = enrollmentByRouter[router.id];
    if (!enrollment || enrollment.status === 'revoked') {
      setInfo('');
      setError('No hay alta vinculada a este router.');
      return;
    }
    setActionId(router.id);
    setActionLabel(`Generando nc-api.rsc para ${router.name}…`);
    setError('');
    setInfo('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const text = await api.get<string>(`/api/router-enrollment/${enrollment.id}/repair-api`);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nc-api.rsc';
      a.click();
      URL.revokeObjectURL(url);
      setError('');
      setInfo(
        `Descargado nc-api.rsc para ${router.name}. En el MikroTik sube el archivo y ejecuta: /import file-name=nc-api.rsc — luego pulsa Verificar. (No toca WireGuard.)`,
      );
    } catch (err) {
      setInfo('');
      setError(err instanceof Error ? err.message : 'No se pudo descargar el script de reparación API.');
    } finally {
      setActionId('');
      setActionLabel('');
    }
  };

  const handleDownloadEnrollment = async (router: InventoryRouterView) => {
    const enrollment = enrollmentByRouter[router.id];
    if (!enrollment || enrollment.status === 'revoked') {
      setInfo('');
      setError('No hay alta activa vinculada a este router.');
      return;
    }
    setActionId(router.id);
    setActionLabel(`Regenerando script completo para ${router.name}…`);
    setError('');
    setInfo('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const text = await api.get<string>(
        `/api/router-enrollment/${enrollment.id}/download`,
      );
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nc-wg.rsc';
      a.click();
      URL.revokeObjectURL(url);
      setError('');
      setInfo(
        `Descargado nc-wg.rsc para ${router.name} desde su alta existente. ` +
          'Este archivo contiene la configuración completa WireGuard/API/SNMP; descarta versiones anteriores.',
      );
    } catch (err) {
      setInfo('');
      setError(err instanceof Error ? err.message : 'No se pudo descargar el script completo.');
    } finally {
      setActionId('');
      setActionLabel('');
    }
  };

  const handleDelete = async (router: InventoryRouterView) => {
    if (!canDelete) return;
    const ok = confirm(
      `¿Eliminar «${router.name}» del inventario?\n\n` +
        'Se revocará el peer WireGuard y se borrará el alta asociada. ' +
        'Esta acción no se puede deshacer.',
    );
    if (!ok) return;
    setActionId(router.id);
    setActionLabel(`Eliminando ${router.name}…`);
    setError('');
    setInfo('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.delete(`/api/mikrotik/routers/${router.id}`);
      await load({ quiet: true });
      setInfo(`Router «${router.name}» eliminado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el router.');
    } finally {
      setActionId('');
      setActionLabel('');
    }
  };

  const handleOnboardingCompleted = () => {
    onPanelChange('inventory');
    void load({ clearMessages: true });
  };

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
      <RouterOnboardingWizard
        isOpen={showEnrollment}
        onClose={() => onPanelChange('inventory')}
        onCompleted={handleOnboardingCompleted}
        userRole={userRole}
        getAuthHeaders={getAuthHeaders}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Boxes className="w-6 h-6 text-indigo-400" />
            <span>Routers</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Inventario de routers MikroTik (Sistema → Routers). Usa{' '}
            <span className="text-indigo-300">Dar de alta</span> para incorporar un equipo nuevo.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 font-mono">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>INVENTARIO</span>
          </span>
          <button
            type="button"
            onClick={() => void load({ clearMessages: true })}
            disabled={loading || !!actionId}
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

      {actionLabel && (
        <div
          id="routers-action-status"
          className="flex items-center space-x-2 p-3 rounded-lg bg-sky-950/40 border border-sky-800 text-sky-200 text-sm"
        >
          <RefreshCw className="w-4 h-4 shrink-0 animate-spin" />
          <span>{actionLabel}</span>
        </div>
      )}
      {error && (
        <div
          id="routers-action-error"
          className="flex items-start space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm"
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}
      {info && (
        <div
          id="routers-action-info"
          className="flex items-start space-x-2 p-3 rounded-lg bg-emerald-950/30 border border-emerald-900/50 text-emerald-300 text-sm"
        >
          <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap break-words">{info}</span>
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
                  {(canEnroll || canDelete) && (
                    <th className="text-right px-4 py-3 font-medium sticky right-0 bg-slate-950/90">
                      Acciones
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {routers.map((router) => {
                  const enrollment = enrollmentByRouter[router.id];
                  const busy = actionId === router.id;
                  const canVerify =
                    canEnroll &&
                    !!enrollment &&
                    enrollment.status !== 'revoked' &&
                    enrollment.status !== 'online';
                  return (
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
                          title="Pendiente = script generado, aún sin confirmación online vía API"
                        >
                          {PROV_LABEL[router.provisioningStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{router.connectionType}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.managementIp)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.vpnIp)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{router.apiPort}</td>
                      <td className="px-4 py-3 text-slate-300">{dash(router.routerOsVersion)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{dash(router.lastSeenAt)}</td>
                      {(canEnroll || canDelete) && (
                        <td className="px-4 py-3 sticky right-0 bg-slate-900/95">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            {canVerify && (
                              <button
                                type="button"
                                disabled={busy || loading}
                                onClick={() => void handleCheckOnline(router)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-900 hover:bg-emerald-800 text-emerald-200 disabled:opacity-50"
                                title="Verificar online vía API RouterOS sobre WireGuard"
                              >
                                <CheckCircle className="w-3 h-3" />
                                Verificar
                              </button>
                            )}
                            {canEnroll &&
                              !!enrollment &&
                              enrollment.status !== 'revoked' && (
                                <button
                                  type="button"
                                  disabled={busy || loading}
                                  onClick={() => void handleDownloadEnrollment(router)}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-900/80 hover:bg-indigo-800 text-indigo-100 disabled:opacity-50"
                                  title="Regenera el script completo del enrollment existente (WireGuard, API y SNMP)"
                                >
                                  <Download className="w-3 h-3" />
                                  Descargar script
                                </button>
                              )}
                            {canEnroll &&
                              !!enrollment &&
                              enrollment.status !== 'revoked' &&
                              enrollment.status !== 'online' && (
                                <button
                                  type="button"
                                  disabled={busy || loading}
                                  onClick={() => void handleRepairApi(router)}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-900/80 hover:bg-amber-800 text-amber-100 disabled:opacity-50"
                                  title="Descarga nc-api.rsc: recrea solo el usuario API (no toca WG)"
                                >
                                  <Wrench className="w-3 h-3" />
                                  Reparar API
                                </button>
                              )}
                            {canDelete && (
                              <button
                                type="button"
                                disabled={busy || loading}
                                onClick={() => void handleDelete(router)}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-900/50 disabled:opacity-50"
                                title="Eliminar router, alta y peer WireGuard"
                              >
                                <Trash2 className="w-3 h-3" />
                                Eliminar
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-600">
        Ping al servidor WG ≠ online en NugaCore: hace falta login API (puerto 8728). Si el túnel
        responde pero sigue offline, usa <span className="text-amber-500/80">Reparar API</span>,
        importa <span className="font-mono">nc-api.rsc</span> en el MikroTik y vuelve a Verificar.
        El NOC es solo lectura.
      </p>
    </div>
  );
}
