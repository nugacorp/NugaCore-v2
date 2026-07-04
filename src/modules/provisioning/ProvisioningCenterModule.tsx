import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthorizedApi } from '../../lib/apiClient';
import { CheckCircle, ClipboardList, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import type { UserRole } from '../../lib/supabase';
import { canWriteProvisioning } from '../../lib/provisioningRbac';

type ProvisioningStatus = 'PENDING' | 'VALIDATED' | 'SIMULATED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
type ProvisioningActionType = 'SUSPEND_CUSTOMER' | 'REACTIVATE_CUSTOMER' | 'CHANGE_PLAN' | 'CREATE_CUSTOMER' | 'CANCEL_CUSTOMER';

interface ProvisioningPlanStep {
  id: string;
  description: string;
}

type DecisionSource = 'Automation' | 'Manual' | 'Billing' | 'CRM' | 'NOC' | 'Inventory';

interface ProvisioningAction {
  id: string;
  actionType: ProvisioningActionType;
  customerId: string;
  customerName?: string;
  status: ProvisioningStatus;
  decisionSource?: DecisionSource;
  createdAt: string;
  dryRun: true;
  executionPlan: ProvisioningPlanStep[];
  simulationResult?: string;
}

interface Props {
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const ACTION_LABEL: Record<ProvisioningActionType, string> = {
  SUSPEND_CUSTOMER: 'Suspension',
  REACTIVATE_CUSTOMER: 'Reactivacion',
  CHANGE_PLAN: 'Cambio de plan',
  CREATE_CUSTOMER: 'Alta de cliente',
  CANCEL_CUSTOMER: 'Baja de cliente',
};

const STATUS_STYLE: Record<ProvisioningStatus, string> = {
  PENDING: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  VALIDATED: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  SIMULATED: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200',
  APPROVED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  REJECTED: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  CANCELLED: 'border-slate-700 bg-slate-900 text-slate-400',
};

const nextDisabled = (status: ProvisioningStatus, op: string): boolean => {
  if (op === 'validate') return status !== 'PENDING';
  if (op === 'simulate') return status !== 'VALIDATED';
  if (op === 'approve') return status !== 'SIMULATED';
  if (op === 'reject') return !['PENDING', 'VALIDATED', 'SIMULATED'].includes(status);
  if (op === 'cancel') return !['PENDING', 'VALIDATED', 'SIMULATED', 'APPROVED'].includes(status);
  return true;
};

export default function ProvisioningCenterModule({ userRole, getAuthHeaders }: Props) {
  const [actions, setActions] = useState<ProvisioningAction[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const canWrite = canWriteProvisioning(userRole);

  const selected = useMemo(
    () => actions.find((item) => item.id === selectedId) ?? actions[0],
    [actions, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const data = await api.get<ProvisioningAction[]>('/api/provisioning/actions');
      setActions(data);
      if (!selectedId && data[0]) setSelectedId(data[0].id);
      setNotice('');
    } catch {
      setNotice('No se pudo cargar Provisioning Center.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (action: ProvisioningAction, op: 'validate' | 'simulate' | 'approve' | 'reject' | 'cancel') => {
    if (!canWrite) {
      setNotice('Tu rol tiene acceso de lectura a Provisioning Center.');
      return;
    }
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const updated = await api.post<ProvisioningAction>(
        `/api/provisioning/actions/${action.id}/${op}`,
        op === 'reject' ? { reason: 'Rechazado desde Provisioning Center.' } : {},
      );
      setActions((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      setSelectedId(updated.id);
      setNotice('');
    } catch {
      setNotice('No se pudo aplicar la transicion solicitada.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mb-5 flex flex-col gap-3 border-b border-slate-800 pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-400" />
            <h2 className="text-2xl font-bold tracking-tight text-white">Provisioning Center</h2>
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">DRY RUN</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">Las acciones mostradas aquí NO ejecutan cambios reales.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="xl:col-span-7">
          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-3">Acción</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {actions.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={4}>No hay acciones de provisioning.</td>
                  </tr>
                ) : actions.map((action) => (
                  <tr
                    key={action.id}
                    onClick={() => setSelectedId(action.id)}
                    className={`cursor-pointer transition hover:bg-slate-900/70 ${selected?.id === action.id ? 'bg-slate-900' : ''}`}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-200">{ACTION_LABEL[action.actionType]}</td>
                    <td className="px-4 py-3 text-slate-300">{action.customerName || action.customerId}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[action.status]}`}>{action.status}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">{new Date(action.createdAt).toLocaleString('es-MX')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:col-span-5">
          <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Plan de ejecución</h3>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
            {selected ? (
              <>
                <ol className="space-y-2">
                  {selected.executionPlan.map((step) => (
                    <li key={step.id} className="rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                      {step.description}
                    </li>
                  ))}
                </ol>
                <div className="mt-3 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
                  Resultado simulación: {selected.simulationResult || 'Pendiente'}
                </div>
                <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                  Decision Source: <span className="font-mono text-indigo-300">{selected.decisionSource || 'Manual'}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(['validate', 'simulate', 'approve', 'reject', 'cancel'] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      disabled={!canWrite || nextDisabled(selected.status, op)}
                      onClick={() => mutate(selected, op)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {op === 'approve' ? <CheckCircle className="h-3.5 w-3.5" /> : op === 'reject' ? <XCircle className="h-3.5 w-3.5" /> : null}
                      {op === 'validate' ? 'Validar' : op === 'simulate' ? 'Simular' : op === 'approve' ? 'Aprobar' : op === 'reject' ? 'Rechazar' : 'Cancelar'}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-8 text-center text-xs text-slate-500">
                Selecciona una acción para ver su plan.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
