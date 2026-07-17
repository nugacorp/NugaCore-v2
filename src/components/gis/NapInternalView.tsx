import React, { useMemo, useState } from 'react';
import { X, Cable, ArrowRight, User } from 'lucide-react';
import type { NapBox } from '../../types';

interface NapInternalViewProps {
  nap: NapBox;
  allNaps: NapBox[];
  onClose: () => void;
  onPortUpdate?: (napId: string, portNum: number, patch: {
    status?: 'free' | 'occupied';
    client?: string;
    continuesToNapId?: string;
    continuesToThread?: number;
  }) => Promise<void>;
}

const napNameById = (naps: NapBox[], id?: string) =>
  id ? naps.find((n) => n.id === id)?.name ?? id : '—';

/** Vista interna de NAP: grilla de puertos, hilos y continuidad. */
export default function NapInternalView({
  nap,
  allNaps,
  onClose,
  onPortUpdate,
}: NapInternalViewProps) {
  const [editingPort, setEditingPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => {
    const total = nap.ports.length || nap.fibersTotal;
    const used = nap.ports.filter((p) => p.status === 'occupied').length;
    const free = Math.max(0, total - used);
    return { total, used, free };
  }, [nap]);

  const savePort = async (
    portNum: number,
    patch: {
      status?: 'free' | 'occupied';
      client?: string;
      continuesToNapId?: string;
      continuesToThread?: number;
    },
  ) => {
    if (!onPortUpdate) return;
    setBusy(true);
    try {
      await onPortUpdate(nap.id, portNum, patch);
      setEditingPort(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      id="nap-internal-view"
      className="absolute bottom-3 right-3 z-[520] w-[min(100%,340px)] max-h-[70%] overflow-hidden flex flex-col bg-white border border-slate-200 rounded-xl shadow-2xl text-slate-700"
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-emerald-50/80">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-mono">NAP interna</p>
          <h4 className="font-semibold text-slate-900 truncate">{nap.name}</h4>
          <p className="text-[11px] font-mono text-slate-500 mt-0.5">
            PON {nap.ponPort} · {nap.splitRatio} · {nap.coverageMeters}m
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white"
          aria-label="Cerrar vista NAP"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-2 grid grid-cols-3 gap-2 border-b border-slate-100 text-center font-mono text-[10px]">
        <div>
          <span className="block text-slate-400">Total</span>
          <span className="font-bold text-slate-800">{stats.total}</span>
        </div>
        <div>
          <span className="block text-slate-400">Libres</span>
          <span className="font-bold text-emerald-600">{stats.free}</span>
        </div>
        <div>
          <span className="block text-slate-400">Usados</span>
          <span className="font-bold text-amber-600">{stats.used}</span>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1">
          <Cable className="w-3 h-3" /> Puertos / hilos
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(nap.ports.length > 0
            ? nap.ports
            : Array.from({ length: nap.fibersTotal }, (_, i) => ({
                num: i + 1,
                status: 'free' as const,
                client: '',
              }))
          ).map((port) => (
            <div
              key={port.num}
              id={`nap-port-${port.num}`}
              className={`rounded-lg border px-2.5 py-2 text-[11px] font-mono ${
                port.status === 'occupied'
                  ? 'border-amber-200 bg-amber-50/60'
                  : 'border-emerald-200 bg-emerald-50/40'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-slate-800">P{port.num}</span>
                <span
                  className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${
                    port.status === 'occupied'
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-emerald-200 text-emerald-900'
                  }`}
                >
                  {port.status === 'occupied' ? 'ocupado' : 'libre'}
                </span>
              </div>
              {port.client && (
                <p className="mt-1 text-slate-600 truncate flex items-center gap-1">
                  <User className="w-3 h-3 shrink-0" />
                  {port.client}
                </p>
              )}
              {(port.continuesToNapId || port.continuesToThread) && (
                <p className="mt-1 text-violet-700 flex items-center gap-1 text-[10px]">
                  <ArrowRight className="w-3 h-3 shrink-0" />
                  {napNameById(allNaps, port.continuesToNapId)}
                  {port.continuesToThread ? ` · hilo ${port.continuesToThread}` : ''}
                </p>
              )}
              {onPortUpdate && editingPort === port.num && (
                <div className="mt-2 space-y-1">
                  <select
                    defaultValue={port.continuesToNapId || ''}
                    className="w-full text-[10px] rounded border border-slate-200 px-1 py-0.5"
                    id={`nap-port-continue-${port.num}`}
                  >
                    <option value="">Sin continuidad</option>
                    {allNaps
                      .filter((n) => n.id !== nap.id)
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    defaultValue={port.continuesToThread ?? ''}
                    placeholder="Hilo destino"
                    className="w-full text-[10px] rounded border border-slate-200 px-1 py-0.5"
                    id={`nap-port-thread-${port.num}`}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="w-full text-[10px] rounded bg-violet-600 text-white py-1"
                    onClick={() => {
                      const sel = document.getElementById(
                        `nap-port-continue-${port.num}`,
                      ) as HTMLSelectElement | null;
                      const inp = document.getElementById(
                        `nap-port-thread-${port.num}`,
                      ) as HTMLInputElement | null;
                      void savePort(port.num, {
                        continuesToNapId: sel?.value || undefined,
                        continuesToThread: inp?.value ? Number(inp.value) : undefined,
                      });
                    }}
                  >
                    Guardar continuidad
                  </button>
                </div>
              )}
              {onPortUpdate && editingPort !== port.num && (
                <button
                  type="button"
                  className="mt-1.5 text-[10px] text-violet-600 hover:underline"
                  onClick={() => setEditingPort(port.num)}
                >
                  Editar continuidad
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
