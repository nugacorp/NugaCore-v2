import React, { useCallback, useEffect, useState } from 'react';
import { createAuthorizedApi } from '../../lib/apiClient';
import { CheckCircle2, ClipboardList, Lock, Play, ShieldCheck, XCircle, Ban, ListChecks } from 'lucide-react';

// ====================================================================
// FAST-1 — Safe Command Queue (Dry-Run) — vista DRY RUN.
//
// Esta cola NO ejecuta comandos reales. Solo transiciones de estado
// auditadas (PENDING/VALIDATED/SIMULATED/APPROVED/REJECTED/CANCELLED) sobre
// comandos en dry-run. No hay ejecución real ni acción de ejecución de comandos.
// ====================================================================

type SafeCommandStatus = 'PENDING' | 'VALIDATED' | 'SIMULATED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type RiskLevel = 'low' | 'medium' | 'high';

interface SafeCommand {
  id: string;
  createdAt: string;
  createdBy: string;
  commandType: string;
  targetId: string;
  description: string;
  status: SafeCommandStatus;
  dryRun: boolean;
  wouldExecute: boolean;
  riskLevel: RiskLevel;
  simulatedCommands: string[];
  safetyWarnings: string[];
  validatedBy?: string;
  approvedBy?: string;
  notes?: string;
}

interface SafeCommandAudit {
  id: string;
  commandId: string;
  timestamp: string;
  actor: string;
  event: string;
  details: string;
}

interface SafeCommandDetail {
  command: SafeCommand;
  audit: SafeCommandAudit[];
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const dash = (value?: string): string => (value && value.trim() !== '' ? value : '—');

const statusBadgeClass: Record<SafeCommandStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  VALIDATED: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
  SIMULATED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20',
  APPROVED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  REJECTED: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  CANCELLED: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
};

const riskBadgeClass: Record<RiskLevel, string> = {
  low: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  high: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

export default function SafeCommandQueueModule({ getAuthHeaders }: Props) {
  const [commands, setCommands] = useState<SafeCommand[]>([]);
  const [detail, setDetail] = useState<SafeCommandDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      setCommands(await api.get<SafeCommand[]>('/api/safe-command-queue'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido cargando la cola.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const openDetail = useCallback(
    async (id: string) => {
      try {
        const api = createAuthorizedApi(getAuthHeaders);
        setDetail(await api.get<SafeCommandDetail>(`/api/safe-command-queue/${id}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error cargando detalle.');
      }
    },
    [getAuthHeaders],
  );

  // Transiciones SEGURAS (dry-run): POST que solo cambian estado + auditan.
  const transition = useCallback(
    async (id: string, op: 'validate' | 'simulate' | 'approve' | 'reject' | 'cancel') => {
      try {
        const api = createAuthorizedApi(getAuthHeaders);
        await api.post(`/api/safe-command-queue/${id}/${op}`, {});
        await load();
        await openDetail(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Error en ${op}.`);
      }
    },
    [getAuthHeaders, load, openDetail],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-full text-slate-100">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <ListChecks className="w-6 h-6 text-indigo-400" />
            <span>Safe Command Queue</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">Cola de comandos en dry-run. Sin ejecución real.</p>
        </div>

        <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-indigo-800 text-xs text-indigo-300 font-mono">
          <Lock className="w-3.5 h-3.5" />
          <span>DRY RUN</span>
        </span>
      </div>

      <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-900 text-indigo-200 text-sm">
        Esta cola NO ejecuta comandos reales.
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium">
            Comandos en cola
          </div>

          {loading ? (
            <div className="py-14 text-center text-sm text-slate-500">Cargando comandos...</div>
          ) : commands.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">No hay comandos en la cola.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Comando</th>
                    <th className="text-left px-4 py-3 font-medium">Target</th>
                    <th className="text-left px-4 py-3 font-medium">Riesgo</th>
                    <th className="text-left px-4 py-3 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {commands.map((command) => (
                    <tr key={command.id} className="hover:bg-slate-850/40">
                      <td className="px-4 py-3">
                        <button onClick={() => openDetail(command.id)} className="font-medium text-indigo-300 hover:underline">
                          {command.commandType}
                        </button>
                        <p className="text-[11px] text-slate-500">{command.description}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">{command.targetId}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs border ${riskBadgeClass[command.riskLevel]}`}>
                          {command.riskLevel}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs border ${statusBadgeClass[command.status]}`}>
                          {command.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {command.status === 'PENDING' && (
                            <button title="Validar" onClick={() => transition(command.id, 'validate')} className="text-sky-300 hover:text-sky-200">
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                          {command.status === 'VALIDATED' && (
                            <button title="Simular (dry-run)" onClick={() => transition(command.id, 'simulate')} className="text-indigo-300 hover:text-indigo-200">
                              <Play className="w-4 h-4" />
                            </button>
                          )}
                          {command.status === 'SIMULATED' && (
                            <button title="Aprobar" onClick={() => transition(command.id, 'approve')} className="text-emerald-400 hover:text-emerald-300">
                              <ShieldCheck className="w-4 h-4" />
                            </button>
                          )}
                          {['PENDING', 'VALIDATED', 'SIMULATED'].includes(command.status) && (
                            <button title="Rechazar" onClick={() => transition(command.id, 'reject')} className="text-rose-400 hover:text-rose-300">
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                          {['PENDING', 'VALIDATED', 'SIMULATED', 'APPROVED'].includes(command.status) && (
                            <button title="Cancelar" onClick={() => transition(command.id, 'cancel')} className="text-slate-400 hover:text-slate-300">
                              <Ban className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-slate-900/70 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300 font-medium flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            <span>Detalle, dry-run y auditoría</span>
          </div>

          {!detail ? (
            <div className="py-14 text-center text-sm text-slate-500">
              Seleccioná un comando para ver su dry-run, advertencias y auditoría.
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="text-sm">
                <p className="text-slate-200 font-medium">{detail.command.commandType}</p>
                <p className="text-[11px] text-slate-500 font-mono">
                  {detail.command.targetId} · {detail.command.status} · riesgo {detail.command.riskLevel}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  dryRun={String(detail.command.dryRun)} · wouldExecute={String(detail.command.wouldExecute)}
                </p>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-400 mb-2">Comandos simulados (no ejecutados)</p>
                <ul className="space-y-1">
                  {detail.command.simulatedCommands.map((line, i) => (
                    <li key={i} className="text-[11px] text-slate-400 font-mono">{line}</li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-400 mb-2">Advertencias de seguridad</p>
                <ul className="space-y-1">
                  {detail.command.safetyWarnings.map((line, i) => (
                    <li key={i} className="text-[11px] text-amber-300">{line}</li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-400 mb-2">Historial</p>
                <ul className="space-y-2">
                  {detail.audit.map((entry) => (
                    <li key={entry.id} className="text-[11px] text-slate-400">
                      <span className="font-mono text-slate-300">{entry.event}</span> · {dash(entry.actor)}
                      <p className="text-slate-500">{entry.details}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500 flex items-center gap-2">
        <ShieldCheck className="w-3.5 h-3.5" />
        FAST-1 Safe Command Queue — dry-run; sin RouterOS, sin worker live, sin ejecución real.
      </p>
    </div>
  );
}
