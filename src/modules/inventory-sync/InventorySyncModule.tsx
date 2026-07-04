import React, { useCallback, useEffect, useState } from 'react';
import { createAuthorizedApi } from '../../lib/apiClient';
import {
  Activity,
  CheckCircle,
  Eye,
  GitCompare,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

// ====================================================================
// PROD-6 — Inventory Sync Read-Only.
//
// Compara el inventario NugaCore contra un snapshot READ-ONLY de RouterOS y
// muestra las diferencias. NO modifica routers, no escribe inventario y no
// ejecuta comandos: es estrictamente de lectura.
// ====================================================================

type DifferenceType =
  | 'ROUTER_MISSING'
  | 'INTERFACE_MISSING'
  | 'INTERFACE_EXTRA'
  | 'ROUTE_MISSING'
  | 'ROUTE_EXTRA'
  | 'WIREGUARD_PEER_MISSING'
  | 'WIREGUARD_PEER_EXTRA';

interface SyncDifference {
  type: DifferenceType;
  routerId: string;
  element: string;
  detail: string;
}

interface SyncStatus {
  lastSyncAt: string;
  source: string;
  readOnly: boolean;
  status: 'IN_SYNC' | 'OUT_OF_SYNC';
  totalDifferences: number;
  countsByType: Record<DifferenceType, number>;
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const TYPE_LABEL: Record<DifferenceType, string> = {
  ROUTER_MISSING: 'Router faltante',
  INTERFACE_MISSING: 'Interfaz faltante',
  INTERFACE_EXTRA: 'Interfaz extra',
  ROUTE_MISSING: 'Ruta faltante',
  ROUTE_EXTRA: 'Ruta extra',
  WIREGUARD_PEER_MISSING: 'Peer WG faltante',
  WIREGUARD_PEER_EXTRA: 'Peer WG extra',
};

// "Estado" legible por diferencia: lo que NugaCore espera vs lo que el router tiene.
const stateLabel = (type: DifferenceType): string => {
  if (type === 'ROUTER_MISSING') return 'Router no responde';
  return type.endsWith('_MISSING') ? 'Falta en router' : 'Extra en router';
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX');
};

export default function InventorySyncModule({ getAuthHeaders }: Props) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [differences, setDifferences] = useState<SyncDifference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const [statusBody, diffBody] = await Promise.all([
        api.get<typeof status>('/api/inventory-sync/status'),
        api.get<{ differences?: unknown }>('/api/inventory-sync/differences'),
      ]);
      setStatus(statusBody);
      setDifferences(Array.isArray(diffBody.differences) ? diffBody.differences : []);
    } catch (err) {
      setStatus(null);
      setDifferences([]);
      setError(err instanceof Error ? err.message : 'Error desconocido en Inventory Sync.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const source = (status?.source ?? 'mock').toUpperCase();
  const isRealSource = source === 'ROUTEROS';
  const inSync = status?.status === 'IN_SYNC';

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-full text-slate-100">
      {/* Encabezado */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <GitCompare className="w-6 h-6 text-indigo-400" />
            <span>Inventory Sync</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Compara el inventario de NugaCore contra RouterOS (solo lectura).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border ${
              isRealSource
                ? 'bg-slate-900 border-emerald-800 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-300'
            }`}
            title="Origen efectivo del snapshot RouterOS (mock o CHR de laboratorio)"
          >
            <span className="text-slate-500">Fuente:</span>
            <span>{source}</span>
          </span>
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-indigo-800 text-xs text-indigo-300 font-mono">
            <Eye className="w-3.5 h-3.5" />
            <span>READ ONLY</span>
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Actualizar lectura</span>
          </button>
        </div>
      </div>

      {/* Banner read-only */}
      <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900 text-indigo-200 text-sm flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 shrink-0" />
        <span>Esta funcionalidad no modifica routers.</span>
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <span className="text-[10px] text-slate-500 font-mono uppercase block">Última sincronización</span>
          <span className="text-sm font-mono text-slate-200 mt-1 block">
            {status ? formatDate(status.lastSyncAt) : '—'}
          </span>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <span className="text-[10px] text-slate-500 font-mono uppercase block">Diferencias</span>
          <span className="text-2xl font-extrabold text-white mt-1 block">
            {status ? status.totalDifferences : '—'}
          </span>
        </div>
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4">
          <span className="text-[10px] text-slate-500 font-mono uppercase block">Estado general</span>
          <span
            className={`inline-flex items-center gap-1.5 text-sm font-bold mt-1.5 ${
              inSync ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {inSync ? <CheckCircle className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            {status ? (inSync ? 'En sincronía' : 'Fuera de sincronía') : '—'}
          </span>
        </div>
      </div>

      {/* Tabla de diferencias */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-indigo-400" />
          <span>Diferencias detectadas</span>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">Cargando Inventory Sync...</div>
        ) : differences.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            No hay diferencias: el inventario coincide con RouterOS.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium">Router</th>
                  <th className="text-left px-4 py-3 font-medium">Elemento</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {differences.map((diff, idx) => (
                  <tr key={`${diff.type}-${diff.element}-${idx}`} className="hover:bg-slate-850/40">
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded border bg-slate-800 border-slate-700 text-slate-300">
                        {TYPE_LABEL[diff.type] ?? diff.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{diff.routerId}</td>
                    <td className="px-4 py-3 font-mono text-slate-200">{diff.element}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded border ${
                          diff.type.endsWith('_EXTRA')
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/20'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/20'
                        }`}
                      >
                        {stateLabel(diff.type)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" />
        PROD-6 Inventory Sync — solo lectura; sin worker live, sin escritura en routers. Fuente actual: {source}.
      </p>
    </div>
  );
}
