import React, { useMemo, useState } from 'react';
import { Cable, Plus, Route, Trash2 } from 'lucide-react';
import type { FiberSegment, NapBox, OltFTTH } from '../../types';

interface FtthInfrastructurePanelProps {
  naps: NapBox[];
  olts: OltFTTH[];
  segments: FiberSegment[];
  onSegmentsChange?: () => void;
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
}

/** Panel para registrar tramos de fibra vía API (sin localStorage). */
export default function FtthInfrastructurePanel({
  naps,
  olts,
  segments,
  onSegmentsChange,
  getAuthHeaders,
}: FtthInfrastructurePanelProps) {
  const [name, setName] = useState('');
  const [threadCount, setThreadCount] = useState(12);
  const [fromLabel, setFromLabel] = useState('');
  const [toLabel, setToLabel] = useState('');
  const [napId, setNapId] = useState('');
  const [ponPort, setPonPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ponSummary = useMemo(() => {
    const byPon = new Map<string, { naps: number; total: number; free: number; used: number }>();
    for (const nap of naps) {
      const key = nap.ponPort || 'sin-pon';
      const total = nap.ports?.length ?? nap.fibersTotal ?? 0;
      const used =
        nap.ports?.filter((p) => p.status === 'occupied').length ??
        Math.max(0, total - (nap.fibersFree ?? 0));
      const free = Math.max(0, total - used);
      const prev = byPon.get(key) ?? { naps: 0, total: 0, free: 0, used: 0 };
      byPon.set(key, {
        naps: prev.naps + 1,
        total: prev.total + total,
        free: prev.free + free,
        used: prev.used + used,
      });
    }
    return [...byPon.entries()].map(([pon, stats]) => ({ pon, ...stats }));
  }, [naps]);

  const addRoute = async () => {
    const trimmed = name.trim();
    if (!trimmed || !fromLabel.trim() || !toLabel.trim()) return;
    const nap = naps.find((n) => n.id === napId);
    setBusy(true);
    setError(null);
    try {
      const coords: Array<[number, number]> = [];
      if (nap && Number.isFinite(nap.lat) && Number.isFinite(nap.lng)) {
        coords.push([nap.lat, nap.lng]);
      }
      const authHeaders = await Promise.resolve(getAuthHeaders?.() ?? {});
      const res = await fetch('/api/ftth/segments', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          threadCount: Math.max(1, Number(threadCount) || 1),
          fromLabel: fromLabel.trim(),
          toLabel: toLabel.trim(),
          napId: napId || undefined,
          ponPort: ponPort || nap?.ponPort || undefined,
          coordinates: coords,
          segmentType: 'feeder',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      setName('');
      setFromLabel('');
      setToLabel('');
      onSegmentsChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el tramo');
    } finally {
      setBusy(false);
    }
  };

  const removeRoute = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const authHeaders = await Promise.resolve(getAuthHeaders?.() ?? {});
      const res = await fetch(`/api/ftth/segments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`HTTP ${res.status}`);
      }
      onSegmentsChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el tramo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="ftth-infrastructure-panel"
      className="bg-slate-950 border border-emerald-900/30 rounded-3xl p-5 space-y-4"
    >
      <div className="border-b border-slate-900 pb-3">
        <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center gap-2">
          <Route className="w-4 h-4 text-emerald-400" />
          Infraestructura de fibra
        </h3>
        <p className="text-[11px] text-slate-500 font-mono mt-1 leading-snug">
          Tramos persistidos en API. Capacidad libre desde NAPs reales; potencia live cuando la OLT
          esté conectada ({olts.length} OLT en inventario).
        </p>
      </div>

      {ponSummary.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider font-mono text-slate-500">
            Capacidad por Puerto PON
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ponSummary.map((row) => (
              <div
                key={row.pon}
                className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2 font-mono text-[11px]"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-violet-300 font-bold">PON {row.pon}</span>
                  <span className="text-slate-500">{row.naps} NAP</span>
                </div>
                <div className="mt-1 flex justify-between text-slate-400">
                  <span>
                    Libres <span className="text-emerald-400 font-bold">{row.free}</span>
                  </span>
                  <span>
                    Usados <span className="text-amber-400 font-bold">{row.used}</span>
                  </span>
                  <span>
                    Total <span className="text-white font-bold">{row.total}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del tramo (ej. Feeder Centro)"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
        />
        <input
          type="number"
          min={1}
          value={threadCount}
          onChange={(e) => setThreadCount(Number(e.target.value))}
          placeholder="Hilos del cable"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
        />
        <input
          value={fromLabel}
          onChange={(e) => setFromLabel(e.target.value)}
          placeholder="Desde (OLT / empalme)"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
        />
        <input
          value={toLabel}
          onChange={(e) => setToLabel(e.target.value)}
          placeholder="Hasta (NAP / empalme)"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
        />
        <select
          value={napId}
          onChange={(e) => {
            setNapId(e.target.value);
            const nap = naps.find((n) => n.id === e.target.value);
            if (nap?.ponPort) setPonPort(nap.ponPort);
          }}
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
        >
          <option value="">NAP destino (opcional)</option>
          {naps.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} · PON {n.ponPort} · {n.fibersFree}/{n.fibersTotal} libres
            </option>
          ))}
        </select>
        <input
          value={ponPort}
          onChange={(e) => setPonPort(e.target.value)}
          placeholder="Puerto PON (ej. 1/2)"
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white"
        />
      </div>

      <button
        type="button"
        id="ftth-add-fiber-route"
        disabled={busy}
        onClick={() => void addRoute()}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" />
        Registrar tramo de fibra
      </button>

      {error && <p className="text-[11px] text-rose-400 font-mono">{error}</p>}

      <div className="space-y-2 max-h-56 overflow-y-auto">
        {segments.length === 0 ? (
          <p className="text-[11px] text-slate-600 font-mono flex items-center gap-2">
            <Cable className="w-3.5 h-3.5" />
            Sin tramos aún. Agrega el recorrido o importa CSV/GeoJSON.
          </p>
        ) : (
          segments.map((r) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 font-mono text-[11px]"
            >
              <div className="min-w-0">
                <p className="font-bold text-slate-200 truncate">{r.name}</p>
                <p className="text-slate-500 truncate">
                  {r.fromLabel} → {r.toLabel} · {r.threadCount} hilos
                  {r.ponPort ? ` · PON ${r.ponPort}` : ''}
                  {r.coordinates.length > 0 ? ` · ${r.coordinates.length} pts` : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeRoute(r.id)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
                aria-label={`Eliminar tramo ${r.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
