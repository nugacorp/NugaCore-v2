import React, { useCallback, useEffect, useState } from 'react';
import { createAuthorizedApi } from '../../lib/apiClient';
import { CheckCircle2, Lock, Play, ShieldCheck, XCircle, Ban, ClipboardList } from 'lucide-react';

// ====================================================================
// PROD-1 Manual Safe Mode — vista SAFE MODE (no ejecuta cambios reales).
//
// Consume los endpoints mock seguros /api/manual-actions/*. Ninguna acción
// de esta vista ejecuta RouterOS, WireGuard ni comandos reales: solo
// transiciones de estado auditadas (PENDING/APPROVED/REJECTED/SIMULATED/
// CANCELLED). No existe estado EXECUTED.
// ====================================================================

type SafeActionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SIMULATED' | 'CANCELLED';
type ExecutionMode = 'MANUAL' | 'DRY_RUN' | 'FUTURE_AUTOMATION';

interface SafeAction {
  id: string;
  createdAt: string;
  createdBy: string;
  actionType: string;
  targetType: string;
  targetId: string;
  description: string;
  status: SafeActionStatus;
  executionMode: ExecutionMode;
  dryRun: boolean;
  approvedBy?: string;
  approvedAt?: string;
  notes?: string;
}

interface SafeActionAudit {
  id: string;
  actionId: string;
  timestamp: string;
  actor: string;
  event: string;
  details: string;
}

interface SafeActionDetail {
  action: SafeAction;
  audit: SafeActionAudit[];
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const dash = (value?: string): string => (value && value.trim() !== '' ? value : '—');

const statusBadgeClass: Record<SafeActionStatus, string> = {
  PENDING: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  APPROVED: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  REJECTED: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  SIMULATED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/20',
  CANCELLED: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
};

export default function ManualSafeModeModule({ getAuthHeaders }: Props) {
  const [actions, setActions] = useState<SafeAction[]>([]);
  const [detail, setDetail] = useState<SafeActionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      setActions(await api.get<SafeAction[]>('/api/manual-actions'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido cargando acciones.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  const openDetail = useCallback(
    async (id: string) => {
      try {
        const api = createAuthorizedApi(getAuthHeaders);
        setDetail(await api.get<SafeActionDetail>(`/api/manual-actions/${id}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error cargando detalle.');
      }
    },
    [getAuthHeaders],
  );

  // Transiciones SEGURAS: POST que solo cambian estado + auditan. No ejecutan nada.
  const transition = useCallback(
    async (id: string, op: 'approve' | 'reject' | 'simulate' | 'cancel') => {
      try {
        const api = createAuthorizedApi(getAuthHeaders);
        await api.post(`/api/manual-actions/${id}/${op}`, {});
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
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
            <span>Manual Safe Mode</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Acciones manuales auditadas. Sin ejecución real.
          </p>
        </div>

        <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-emerald-800 text-xs text-emerald-400 font-mono">
          <Lock className="w-3.5 h-3.5" />
          <span>SAFE MODE</span>
        </span>
      </div>

      <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-900 text-emerald-200 text-sm">
        Esta funcionalidad NO ejecuta cambios reales. Todas las acciones son simuladas.
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
            Acciones manuales
          </div>

          {loading ? (
            <div className="py-14 text-center text-sm text-slate-500">Cargando acciones...</div>
          ) : actions.length === 0 ? (
            <div className="py-14 text-center text-sm text-slate-500">No hay acciones manuales registradas.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Acción</th>
                    <th className="text-left px-4 py-3 font-medium">Objetivo</th>
                    <th className="text-left px-4 py-3 font-medium">Modo</th>
                    <th className="text-left px-4 py-3 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {actions.map((action) => (
                    <tr key={action.id} className="hover:bg-slate-850/40">
                      <td className="px-4 py-3">
                        <button onClick={() => openDetail(action.id)} className="font-medium text-indigo-300 hover:underline">
                          {action.actionType}
                        </button>
                        <p className="text-[11px] text-slate-500">{action.description}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">
                        {action.targetType}:{action.targetId}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {action.executionMode}
                        {action.dryRun && <span className="ml-1 text-[10px] text-indigo-300">(dry-run)</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs border ${statusBadgeClass[action.status]}`}>
                          {action.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {action.status === 'PENDING' ? (
                          <div className="flex items-center gap-2">
                            <button title="Aprobar" onClick={() => transition(action.id, 'approve')} className="text-emerald-400 hover:text-emerald-300">
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                            <button title="Simular" onClick={() => transition(action.id, 'simulate')} className="text-indigo-300 hover:text-indigo-200">
                              <Play className="w-4 h-4" />
                            </button>
                            <button title="Rechazar" onClick={() => transition(action.id, 'reject')} className="text-rose-400 hover:text-rose-300">
                              <XCircle className="w-4 h-4" />
                            </button>
                            <button title="Cancelar" onClick={() => transition(action.id, 'cancel')} className="text-slate-400 hover:text-slate-300">
                              <Ban className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-600">—</span>
                        )}
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
            <span>Detalle e historial de auditoría</span>
          </div>

          {!detail ? (
            <div className="py-14 text-center text-sm text-slate-500">
              Seleccioná una acción para ver su detalle y auditoría.
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="text-sm">
                <p className="text-slate-200 font-medium">{detail.action.actionType}</p>
                <p className="text-[11px] text-slate-500 font-mono">
                  {detail.action.targetType}:{detail.action.targetId} · {detail.action.status}
                </p>
                <p className="text-xs text-slate-400 mt-1">{detail.action.description}</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Creada por {dash(detail.action.createdBy)} · Aprobada por {dash(detail.action.approvedBy)}
                </p>
                {detail.action.notes && <p className="text-[11px] text-slate-400 mt-1">Notas: {detail.action.notes}</p>}
              </div>

              <div className="border-t border-slate-800 pt-3">
                <p className="text-xs text-slate-400 mb-2">Historial</p>
                <ul className="space-y-2">
                  {detail.audit.map((entry) => (
                    <li key={entry.id} className="text-[11px] text-slate-400">
                      <span className="font-mono text-slate-300">{entry.event}</span> · {entry.actor}
                      <p className="text-slate-500">{entry.details}</p>
                      <p className="text-slate-600 font-mono">{entry.timestamp}</p>
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
        PROD-1 Manual Safe Mode — sin RouterOS, sin escritura real, sin commit mode.
      </p>
    </div>
  );
}
