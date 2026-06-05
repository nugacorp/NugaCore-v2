import React, { useState } from 'react';
import { Bot, Play, Eye, Loader2, ShieldCheck, X } from 'lucide-react';
import type {
  MikrotikRouterView,
  MikrotikWorkerRun,
  RouterSnapshot,
} from '../types';
import type { UserRole } from '../lib/supabase';
import { canGenerateScript } from '../lib/mikrotikRbac';

interface Props {
  routers: MikrotikRouterView[];
  runs: MikrotikWorkerRun[];
  userRole: UserRole;
  onRunWorker: () => Promise<void>;
  onReadRouter: (id: string) => Promise<RouterSnapshot>;
  onRefreshRuns: () => Promise<void>;
}

export default function MikrotikWorkerPanel({ routers, runs, userRole, onRunWorker, onReadRouter, onRefreshRuns }: Props) {
  const canRun = canGenerateScript(userRole);
  const [busy, setBusy] = useState('');
  const [snapshot, setSnapshot] = useState<RouterSnapshot | null>(null);
  const [toast, setToast] = useState<string>('');

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  const run = async () => {
    setBusy('Procesando órdenes (dry-run)...');
    try {
      await onRunWorker();
      await onRefreshRuns();
      flash('Worker ejecutado en dry-run. Ninguna acción real.');
    } catch (e: any) {
      flash(e?.message || 'Error al ejecutar el worker.');
    } finally { setBusy(''); }
  };

  const read = async (id: string) => {
    setBusy('Leyendo router (read-only)...');
    try {
      setSnapshot(await onReadRouter(id));
    } catch (e: any) {
      flash(e?.message || 'Error al leer el router.');
    } finally { setBusy(''); }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
      {toast && (
        <div className="fixed top-5 right-5 z-[60] px-4 py-3 rounded-xl border bg-slate-900 border-slate-700 text-slate-200 text-xs font-mono shadow-xl">{toast}</div>
      )}
      {busy && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex items-center space-x-2 bg-slate-950 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-mono shadow-xl">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /><span>{busy}</span>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-slate-900 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2">
            <Bot className="w-4 h-4 text-indigo-400" />
            <span>Worker MikroTik · Read Only + Dry Run</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Procesa órdenes de Suspensiones en simulación. No ejecuta cortes, no cambia el estado del cliente, no toca el router.
          </p>
        </div>
        {canRun ? (
          <button
            id="mkt-worker-run"
            onClick={run}
            className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl text-xs font-semibold transition"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Procesar órdenes (dry-run)</span>
          </button>
        ) : (
          <span className="text-[11px] bg-slate-800/60 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg font-mono">Solo lectura</span>
        )}
      </div>

      {/* Routers: read-only */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {routers.length === 0 ? (
          <p className="text-slate-500 text-[11px] italic font-mono">Sin routers registrados.</p>
        ) : routers.map((r) => (
          <div key={r.id} className="bg-slate-900/40 border border-slate-900 rounded-xl p-2.5 flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-300 truncate">{r.name} <span className="text-slate-600">({r.id})</span></span>
            <button onClick={() => read(r.id)} className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2 py-1 rounded-lg font-bold">
              <Eye className="w-3.5 h-3.5 text-emerald-400" /><span>Leer</span>
            </button>
          </div>
        ))}
      </div>

      {/* Runs */}
      <div>
        <span className="text-[10px] text-slate-500 uppercase font-mono font-bold">Corridas recientes</span>
        <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 mt-2">
          {runs.length === 0 ? (
            <p className="text-slate-500 text-[11px] italic font-mono">Sin corridas. Ejecuta el worker.</p>
          ) : runs.map((run) => (
            <div key={run.id} className="bg-slate-900/40 border border-slate-900 rounded-xl p-3 text-[11px] font-mono space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-white font-bold">{run.id}</span>
                <span className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[9px] uppercase border ${run.mode === 'live' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-slate-700/30 text-slate-300 border-slate-600/30'}`}>{run.mode}</span>
                  <span className="bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] uppercase">dry-run</span>
                </span>
              </div>
              <div className="text-slate-500">PENDING: {run.pendingFound} · procesadas: {run.processed} · {run.finishedAt.substring(0, 19).replace('T', ' ')}</div>
              {run.results.slice(0, 4).map((res) => (
                <div key={res.orderId} className="border-t border-slate-900/50 pt-1.5">
                  <span className={res.orderType === 'suspension' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                    {res.orderType === 'suspension' ? 'CORTE' : 'REACTIVAR'}
                  </span>
                  <span className="text-slate-400 ml-1">{res.customerId}</span>
                  <div className="text-slate-600 text-[10px] mt-0.5">plan: {res.plannedCommands[0]}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Snapshot modal */}
      {snapshot && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Lectura read-only · {snapshot.routerName}</span>
                <span className={`px-2 py-0.5 rounded text-[9px] uppercase border ${snapshot.source === 'live' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-slate-700/30 text-slate-300 border-slate-600/30'}`}>{snapshot.source}</span>
              </h3>
              <button onClick={() => setSnapshot(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {snapshot.reads.map((rd) => (
              <div key={rd.command}>
                <div className="text-[11px] font-mono text-indigo-300">{rd.command} <span className="text-slate-600">({rd.source})</span></div>
                <pre className="bg-black border border-slate-800 rounded-lg p-2.5 text-[10px] text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap mt-1">{rd.data}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
