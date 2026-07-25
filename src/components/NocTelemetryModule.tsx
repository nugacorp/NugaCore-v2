import React, { useCallback, useEffect, useState } from 'react';
import { createAuthorizedApi } from '../lib/apiClient';
import { Activity, AlertTriangle, Cpu, Gauge, Lock, RadioTower, ShieldAlert, Wifi, WifiOff } from 'lucide-react';

// ====================================================================
// NOC Real Telemetry (Fase 4.11.3) — vista READ-ONLY.
//
// Observabilidad derivada de datos internos: salud agregada, telemetría por
// torre y alertas derivadas. No ejecuta acciones, no escribe, no envía nada.
// Consume endpoints GET: /api/noc/health, /api/noc/towers, /api/noc/routers,
// /api/noc/alerts.
// ====================================================================

interface NocHealthSummary {
  totalRouters: number;
  onlineRouters: number;
  offlineRouters: number;
  warningRouters: number;
  criticalRouters: number;
}

interface NocTowerTelemetry {
  towerId: string;
  towerName: string;
  totalRouters: number;
  online: number;
  offline: number;
  warning: number;
  critical: number;
}

interface NocRouterView {
  id: string;
  name: string;
  status: 'online' | 'offline';
  isOnline: boolean;
  cpuUsagePct: number;
  memoryUsagePct: number;
  lastHealthCheckAt?: string;
  lastSeenAt?: string;
  healthStatus: 'healthy' | 'warning' | 'critical';
  towerId?: string;
  towerName?: string;
}

interface NocDerivedAlert {
  id: string;
  routerId: string;
  routerName: string;
  type: 'router_offline' | 'missing_vpn' | 'missing_credentials' | 'health_stale' | 'high_cpu' | 'high_memory';
  severity: 'critical' | 'warning';
  message: string;
  observedAt?: string;
}

// Telemetría SNMP tenant-scoped: cada WISP solo ve sus propios routers.
type SnmpSource = 'snmp-live' | 'simulated' | 'disabled' | 'pending';

interface SnmpTelemetryRouterView {
  routerId: string;
  name: string;
  source: SnmpSource;
  isReachable: boolean;
  fresh: boolean;
  sysName?: string;
  sysUpTime?: string;
  latencyMs?: number;
  sampledAt?: string;
  note?: string;
}

interface SnmpTelemetryResponse {
  enabled: boolean;
  intervalMs: number;
  generatedAt: string;
  total: number;
  routers: SnmpTelemetryRouterView[];
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const dash = (value?: string): string => (value && value.trim() !== '' ? value : '—');

const snmpBadge = (
  router: SnmpTelemetryRouterView,
): { label: string; className: string } => {
  if (router.source === 'snmp-live' && router.fresh) {
    return { label: 'En vivo', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' };
  }
  if (router.source === 'snmp-live') {
    return { label: 'Reciente', className: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
  }
  if (router.source === 'pending') {
    return { label: 'Sin muestra', className: 'bg-slate-700/40 text-slate-400 border-slate-600/30' };
  }
  if (router.source === 'disabled') {
    return { label: 'Poller off', className: 'bg-slate-700/40 text-slate-400 border-slate-600/30' };
  }
  return { label: 'Sin respuesta', className: 'bg-rose-500/15 text-rose-400 border-rose-500/20' };
};

const healthBadgeClass: Record<NocRouterView['healthStatus'], string> = {
  healthy: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  critical: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

const severityBadgeClass: Record<NocDerivedAlert['severity'], string> = {
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  critical: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

export default function NocTelemetryModule({ getAuthHeaders }: Props) {
  const [health, setHealth] = useState<NocHealthSummary | null>(null);
  const [towers, setTowers] = useState<NocTowerTelemetry[]>([]);
  const [routers, setRouters] = useState<NocRouterView[]>([]);
  const [alerts, setAlerts] = useState<NocDerivedAlert[]>([]);
  const [snmp, setSnmp] = useState<SnmpTelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const [healthData, towersData, routersData, alertsData, snmpData] = await Promise.all([
        api.get<NocHealthSummary>('/api/noc/health'),
        api.get<NocTowerTelemetry[]>('/api/noc/towers'),
        api.get<NocRouterView[]>('/api/noc/routers'),
        api.get<NocDerivedAlert[]>('/api/noc/alerts'),
        api.get<SnmpTelemetryResponse>('/api/snmp/telemetry'),
      ]);

      setHealth(healthData);
      setTowers(towersData);
      setRouters(routersData);
      setAlerts(alertsData);
      setSnmp(snmpData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido cargando telemetría NOC.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const widgets = health
    ? [
        { label: 'Routers Online', value: health.onlineRouters, icon: Wifi },
        { label: 'Routers Offline', value: health.offlineRouters, icon: WifiOff },
        { label: 'Warnings', value: health.warningRouters, icon: AlertTriangle },
        { label: 'Critical', value: health.criticalRouters, icon: ShieldAlert },
        { label: 'Torres monitoreadas', value: towers.length, icon: RadioTower },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-full text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Activity className="w-6 h-6 text-indigo-400" />
            <span>NOC Real Telemetry</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Telemetría operativa derivada de datos internos del sistema. Solo lectura.
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

      {health && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {widgets.map(({ label, value, icon: Icon }) => (
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
            Telemetría por router
          </div>

          {loading ? (
            <div className="py-14 text-center text-sm text-slate-500">Cargando telemetría NOC...</div>
          ) : routers.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">
              No hay routers disponibles para telemetría NOC.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Router</th>
                    <th className="text-left px-4 py-3 font-medium">Torre</th>
                    <th className="text-left px-4 py-3 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 font-medium">CPU</th>
                    <th className="text-left px-4 py-3 font-medium">RAM</th>
                    <th className="text-left px-4 py-3 font-medium">Último check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {routers.map((router) => (
                    <tr key={router.id} className="hover:bg-slate-850/40">
                      <td className="px-4 py-3">
                        <span className="font-medium text-slate-200">{router.name}</span>
                        <span className={`ml-2 px-2 py-0.5 rounded text-[10px] border uppercase ${healthBadgeClass[router.healthStatus]}`}>
                          {router.healthStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{dash(router.towerName)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center space-x-1.5 ${router.isOnline ? 'text-emerald-400' : 'text-slate-500'}`}>
                          <span className={`w-2 h-2 rounded-full ${router.isOnline ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                          <span>{router.status}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{router.cpuUsagePct}%</td>
                      <td className="px-4 py-3 text-slate-300">{router.memoryUsagePct}%</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">
                        {dash(router.lastHealthCheckAt ?? router.lastSeenAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium">
            Panel de alertas derivadas
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

      {towers.length > 0 && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium">
            Telemetría por torre
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Torre</th>
                  <th className="text-left px-4 py-3 font-medium">Routers</th>
                  <th className="text-left px-4 py-3 font-medium">Online</th>
                  <th className="text-left px-4 py-3 font-medium">Offline</th>
                  <th className="text-left px-4 py-3 font-medium">Warning</th>
                  <th className="text-left px-4 py-3 font-medium">Critical</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {towers.map((tower) => (
                  <tr key={tower.towerId} className="hover:bg-slate-850/40">
                    <td className="px-4 py-3 text-slate-200">{tower.towerName}</td>
                    <td className="px-4 py-3 text-slate-300">{tower.totalRouters}</td>
                    <td className="px-4 py-3 text-emerald-400">{tower.online}</td>
                    <td className="px-4 py-3 text-slate-400">{tower.offline}</td>
                    <td className="px-4 py-3 text-amber-400">{tower.warning}</td>
                    <td className="px-4 py-3 text-rose-400">{tower.critical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div
        data-testid="snmp-telemetry-section"
        className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-slate-300 font-medium">
            <Gauge className="w-4 h-4 text-indigo-400" />
            <span>Telemetría SNMP</span>
          </div>
          <span className="text-[11px] text-slate-500 font-mono">
            {snmp?.enabled ? `poller cada ${Math.round((snmp.intervalMs ?? 0) / 1000)}s` : 'poller deshabilitado'}
          </span>
        </div>

        {loading ? (
          <div className="py-14 text-center text-sm text-slate-500">Cargando telemetría SNMP...</div>
        ) : !snmp || snmp.routers.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-500">
            No hay routers con SNMP configurado para este WISP.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Router</th>
                  <th className="text-left px-4 py-3 font-medium">sysName</th>
                  <th className="text-left px-4 py-3 font-medium">sysUpTime</th>
                  <th className="text-left px-4 py-3 font-medium">Latencia</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Última muestra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {snmp.routers.map((router) => {
                  const badge = snmpBadge(router);
                  return (
                    <tr key={router.routerId} data-testid={`snmp-tel-${router.routerId}`} className="hover:bg-slate-850/40">
                      <td className="px-4 py-3 font-medium text-slate-200">{router.name}</td>
                      <td className="px-4 py-3 text-slate-300">{dash(router.sysName)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.sysUpTime)}</td>
                      <td className="px-4 py-3 text-slate-300">
                        {typeof router.latencyMs === 'number' ? `${router.latencyMs} ms` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] border uppercase ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{dash(router.sampledAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <Cpu className="w-3.5 h-3.5" />
        Esta vista no ejecuta acciones ni modifica routers.
      </p>
    </div>
  );
}
