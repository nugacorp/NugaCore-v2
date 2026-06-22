import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Cpu,
  Eye,
  HardDrive,
  Network,
  Route as RouteIcon,
  Server,
  Shield,
  XCircle,
} from 'lucide-react';

// ====================================================================
// PROD-3 — RouterOS Read-Only Lab — vista READ ONLY LAB.
//
// Esta vista NO ejecuta cambios ni comandos RouterOS. Solo muestra datos de
// laboratorio en modo mock (identidad, sistema, interfaces, rutas, WireGuard).
// No hay botones de escritura ni acción de ejecución.
// ====================================================================

interface RouterOsIdentity {
  name: string;
  routerId: string;
  source: string;
  readOnly: boolean;
}

interface RouterOsSystem {
  routerosVersion: string;
  uptime: string;
  cpuLoad: number;
  memoryTotal: number;
  memoryFree: number;
  boardName: string;
  architectureName: string;
  source: string;
}

interface RouterOsInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  mtu: number;
  macAddress?: string;
  rxBytes: number;
  txBytes: number;
}

interface RouterOsRoute {
  dstAddress: string;
  gateway: string;
  distance: number;
  active: boolean;
  routingTable: string;
}

interface RouterOsWireguardInterface {
  name: string;
  listenPort: number;
  running: boolean;
  mtu: number;
}

interface RouterOsWireguardPeer {
  interface: string;
  allowedAddress: string;
  endpoint: string;
  lastHandshake: string;
  rxBytes: number;
  txBytes: number;
  enabled: boolean;
}

interface RouterOsWireguardSummary {
  interfaces: RouterOsWireguardInterface[];
  peers: RouterOsWireguardPeer[];
  source: string;
}

interface RouterOsSnapshot {
  identity: RouterOsIdentity;
  system: RouterOsSystem;
  interfaces: RouterOsInterface[];
  routes: RouterOsRoute[];
  wireguard: RouterOsWireguardSummary;
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const dash = (value?: string): string => (value && value.trim() !== '' ? value : '—');

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, exp)).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
};

const boolBadge = (value: boolean, labels: [string, string]): React.ReactElement => (
  <span
    className={`px-2 py-0.5 rounded text-xs border ${
      value
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
        : 'bg-slate-500/15 text-slate-400 border-slate-500/20'
    }`}
  >
    {value ? labels[0] : labels[1]}
  </span>
);

export default function RouterOSReadOnlyModule({ getAuthHeaders }: Props) {
  const [data, setData] = useState<RouterOsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const paths = ['identity', 'system', 'interfaces', 'routes', 'wireguard'];
      const responses = await Promise.all(
        paths.map((path) => fetch(`/api/routeros/${path}`, { headers })),
      );
      if (responses.some((res) => !res.ok)) {
        throw new Error('No se pudieron cargar los datos RouterOS del laboratorio.');
      }
      const [identity, system, interfaces, routes, wireguard] = await Promise.all(
        responses.map((res) => res.json()),
      );
      setData({ identity, system, interfaces, routes, wireguard });
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Error desconocido cargando RouterOS.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fuente efectiva de los datos (mock por defecto / routeros si el CHR de lab
  // respondió). Solo indicador visual; no cambia el comportamiento read-only.
  const dataSource = (data?.identity.source ?? 'mock').toUpperCase();
  const isRealSource = dataSource === 'ROUTEROS';

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-full text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <Server className="w-6 h-6 text-indigo-400" />
            <span>RouterOS Read-Only Lab</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Datos RouterOS de laboratorio. Solo lectura.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border ${
              isRealSource
                ? 'bg-slate-900 border-emerald-800 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-300'
            }`}
            title="Origen efectivo de los datos (mock o CHR de laboratorio)"
          >
            <span className="text-slate-500">Fuente:</span>
            <span>{dataSource}</span>
          </span>
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-indigo-800 text-xs text-indigo-300 font-mono">
            <Eye className="w-3.5 h-3.5" />
            <span>READ ONLY LAB</span>
          </span>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900 text-indigo-200 text-sm">
        Esta vista no ejecuta cambios ni comandos RouterOS.
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-14 text-center text-sm text-slate-500">Cargando datos RouterOS...</div>
      ) : !data ? (
        <div className="py-14 text-center text-sm text-slate-500">
          No hay datos RouterOS disponibles.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Identidad + Sistema */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm text-slate-300 font-medium mb-3">
                <Server className="w-4 h-4 text-indigo-400" />
                <span>Identidad</span>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Nombre</dt>
                  <dd className="font-mono text-slate-200">{dash(data.identity.name)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Router ID</dt>
                  <dd className="font-mono text-slate-300">{dash(data.identity.routerId)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Fuente</dt>
                  <dd className="font-mono text-indigo-300">{dash(data.identity.source)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Solo lectura</dt>
                  <dd>{boolBadge(data.identity.readOnly, ['sí', 'no'])}</dd>
                </div>
              </dl>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm text-slate-300 font-medium mb-3">
                <Cpu className="w-4 h-4 text-indigo-400" />
                <span>CPU & RAM</span>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">CPU Load</dt>
                  <dd className="font-mono text-slate-200">{data.system.cpuLoad}%</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">RAM total</dt>
                  <dd className="font-mono text-slate-300">{formatBytes(data.system.memoryTotal)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">RAM libre</dt>
                  <dd className="font-mono text-slate-300">{formatBytes(data.system.memoryFree)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Uptime</dt>
                  <dd className="font-mono text-slate-300">{dash(data.system.uptime)}</dd>
                </div>
              </dl>
            </div>

            <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center gap-2 text-sm text-slate-300 font-medium mb-3">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                <span>Sistema</span>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">RouterOS</dt>
                  <dd className="font-mono text-slate-200">{dash(data.system.routerosVersion)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Board</dt>
                  <dd className="font-mono text-slate-300">{dash(data.system.boardName)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Arquitectura</dt>
                  <dd className="font-mono text-slate-300">{dash(data.system.architectureName)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Fuente</dt>
                  <dd className="font-mono text-indigo-300">{dash(data.system.source)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Interfaces */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium flex items-center gap-2">
              <Network className="w-4 h-4 text-indigo-400" />
              <span>Interfaces</span>
            </div>
            {data.interfaces.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No hay interfaces.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Nombre</th>
                      <th className="text-left px-4 py-3 font-medium">Tipo</th>
                      <th className="text-left px-4 py-3 font-medium">Estado</th>
                      <th className="text-left px-4 py-3 font-medium">MTU</th>
                      <th className="text-left px-4 py-3 font-medium">MAC</th>
                      <th className="text-left px-4 py-3 font-medium">RX</th>
                      <th className="text-left px-4 py-3 font-medium">TX</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.interfaces.map((iface) => (
                      <tr key={iface.name} className="hover:bg-slate-850/40">
                        <td className="px-4 py-3 font-mono text-slate-200">{iface.name}</td>
                        <td className="px-4 py-3 text-slate-400">{iface.type}</td>
                        <td className="px-4 py-3">
                          {iface.disabled
                            ? boolBadge(false, ['', 'disabled'])
                            : boolBadge(iface.running, ['running', 'down'])}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{iface.mtu}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">
                          {dash(iface.macAddress)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">
                          {formatBytes(iface.rxBytes)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">
                          {formatBytes(iface.txBytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Rutas */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium flex items-center gap-2">
              <RouteIcon className="w-4 h-4 text-indigo-400" />
              <span>Rutas</span>
            </div>
            {data.routes.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No hay rutas.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Destino</th>
                      <th className="text-left px-4 py-3 font-medium">Gateway</th>
                      <th className="text-left px-4 py-3 font-medium">Distancia</th>
                      <th className="text-left px-4 py-3 font-medium">Activa</th>
                      <th className="text-left px-4 py-3 font-medium">Tabla</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.routes.map((route, idx) => (
                      <tr key={`${route.dstAddress}-${idx}`} className="hover:bg-slate-850/40">
                        <td className="px-4 py-3 font-mono text-slate-200">{route.dstAddress}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{route.gateway}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{route.distance}</td>
                        <td className="px-4 py-3">{boolBadge(route.active, ['activa', 'inactiva'])}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{route.routingTable}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* WireGuard summary */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" />
              <span>WireGuard summary</span>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-400 mb-2">Interfaces ({data.wireguard.interfaces.length})</p>
                {data.wireguard.interfaces.length === 0 ? (
                  <p className="text-sm text-slate-500">Sin interfaces WireGuard.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.wireguard.interfaces.map((wg) => (
                      <li key={wg.name} className="text-[11px] text-slate-400 font-mono flex items-center gap-2">
                        <span className="text-slate-200">{wg.name}</span>
                        <span>· port {wg.listenPort}</span>
                        <span>· mtu {wg.mtu}</span>
                        {boolBadge(wg.running, ['running', 'down'])}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-2">Peers ({data.wireguard.peers.length})</p>
                {data.wireguard.peers.length === 0 ? (
                  <p className="text-sm text-slate-500">Sin peers WireGuard.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.wireguard.peers.map((peer, idx) => (
                      <li
                        key={`${peer.interface}-${peer.allowedAddress}-${idx}`}
                        className="text-[11px] text-slate-400 font-mono flex items-center gap-2 flex-wrap"
                      >
                        <span className="text-slate-200">{peer.allowedAddress}</span>
                        <span>· {peer.interface}</span>
                        <span>· hs {peer.lastHandshake}</span>
                        {boolBadge(peer.enabled, ['enabled', 'disabled'])}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" />
        RouterOS Read-Only Lab — solo lectura; sin worker live, sin escritura. Fuente actual: {dataSource}.
      </p>
    </div>
  );
}
