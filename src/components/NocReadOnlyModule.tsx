import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Cpu, Lock, Server, ShieldAlert, Wifi, KeyRound } from 'lucide-react';

interface NocSummary {
  totalRouters: number;
  onlineRouters: number;
  offlineRouters: number;
  routersWithVpn: number;
  routersWithCredentials: number;
  pendingProvisioning: number;
  staleRouters: number;
  activeAlerts: number;
  criticalAlerts: number;
  warningAlerts: number;
}

interface NocRouterView {
  id: string;
  name: string;
  status: 'online' | 'offline';
  isOnline: boolean;
  connectionType: string;
  managementIp?: string;
  vpnIp?: string;
  lastSeenAt?: string;
  lastHealthCheckAt?: string;
  routerosVersion?: string;
  cpuUsagePct: number;
  memoryUsagePct: number;
  healthStatus: 'healthy' | 'warning' | 'critical';
}

interface NocDerivedAlert {
  id: string;
  routerId: string;
  routerName: string;
  type:
    | 'router_offline'
    | 'missing_vpn'
    | 'missing_credentials'
    | 'health_stale'
    | 'high_cpu'
    | 'high_memory';
  severity: 'critical' | 'warning';
  message: string;
  observedAt?: string;
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const dash = (value?: string): string => (value && value.trim() !== '' ? value : '—');

const healthBadgeClass: Record<NocRouterView['healthStatus'], string> = {
  healthy: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  critical: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

const severityBadgeClass: Record<NocDerivedAlert['severity'], string> = {
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  critical: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

export default function NocReadOnlyModule({ getAuthHeaders }: Props) {
  const [summary, setSummary] = useState<NocSummary | null>(null);
  const [routers, setRouters] = useState<NocRouterView[]>([]);
  const [alerts, setAlerts] = useState<NocDerivedAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const [summaryRes, routersRes, alertsRes] = await Promise.all([
        fetch('/api/noc/summary', { headers }),
        fetch('/api/noc/routers', { headers }),
        fetch('/api/noc/alerts', { headers }),
      ]);

      if (!summaryRes.ok || !routersRes.ok || !alertsRes.ok) {
        throw new Error('No se pudo cargar el tablero NOC read-only.');
      }

      setSummary((await summaryRes.json()) as NocSummary);
      setRouters((await routersRes.json()) as NocRouterView[]);
      setAlerts((await alertsRes.json()) as NocDerivedAlert[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido cargando NOC.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const summaryCards = summary
    ? [
        { label: 'Routers totales', value: summary.totalRouters, icon: Server },
        { label: 'Online', value: summary.onlineRouters, icon: Server },
        { label: 'Offline', value: summary.offlineRouters, icon: ShieldAlert },
        { label: 'Alertas activas', value: summary.activeAlerts, icon: AlertTriangle },
        { label: 'Con VPN', value: summary.routersWithVpn, icon: Wifi },
        { label: 'Con credenciales', value: summary.routersWithCredentials, icon: KeyRound },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-full text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <ShieldAlert className="w-6 h-6 text-indigo-400" />
            <span>NOC Read-Only</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Monitor operativo derivado de datos internos del sistema. Solo lectura.
          </p>
        </div>

        <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 font-mono">
          <Lock className="w-3.5 h-3.5 text-emerald-400" />
          <span>READ-ONLY</span>
        </span>
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium">
            Routers operativos
          </div>

          {loading ? (
            <div className="py-14 text-center text-sm text-slate-500">Cargando vista NOC...</div>
          ) : routers.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">
              No hay routers disponibles para monitoreo NOC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Router</th>
                    <th className="text-left px-4 py-3 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 font-medium">Salud</th>
                    <th className="text-left px-4 py-3 font-medium">Conexión</th>
                    <th className="text-left px-4 py-3 font-medium">IP gestión</th>
                    <th className="text-left px-4 py-3 font-medium">IP VPN</th>
                    <th className="text-left px-4 py-3 font-medium">CPU</th>
                    <th className="text-left px-4 py-3 font-medium">Mem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {routers.map((router) => (
                    <tr key={router.id} className="hover:bg-slate-850/40">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-200">{router.name}</p>
                        <p className="text-[11px] text-slate-500">{dash(router.routerosVersion)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center space-x-1.5 ${router.isOnline ? 'text-emerald-400' : 'text-slate-500'}`}>
                          <span className={`w-2 h-2 rounded-full ${router.isOnline ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                          <span>{router.status}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs border ${healthBadgeClass[router.healthStatus]}`}>
                          {router.healthStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{router.connectionType}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.managementIp)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.vpnIp)}</td>
                      <td className="px-4 py-3 text-slate-300">{router.cpuUsagePct}%</td>
                      <td className="px-4 py-3 text-slate-300">{router.memoryUsagePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium">
            Alertas derivadas
          </div>

          {loading ? (
            <div className="py-14 text-center text-sm text-slate-500">Cargando alertas...</div>
          ) : alerts.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">Sin alertas derivadas por el momento.</div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {alerts.map((alert) => (
                <li key={alert.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-200">{alert.message}</p>
                    <span className={`px-2 py-0.5 rounded text-[10px] border uppercase ${severityBadgeClass[alert.severity]}`}>
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {alert.routerName} · {alert.type} · {dash(alert.observedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <Cpu className="w-3.5 h-3.5" />
        Esta vista no ejecuta comandos ni modifica routers.
      </p>
    </div>
  );
}
