import React, { useState } from 'react';
import {
  Ban,
  RefreshCw,
  Play,
  Loader2,
  ShieldCheck,
  ClipboardList,
  History,
  Settings,
  Lock,
} from 'lucide-react';
import type {
  CustomerServiceView,
  SuspensionOrder,
  SuspensionEvent,
  SuspensionPolicy,
  ServiceStatus,
} from '../types';
import type { UserRole } from '../lib/supabase';
import { canEvaluateSuspension, canManageSuspensionPolicy } from '../lib/suspensionRbac';
import {
  serviceStatusBadge,
  billingStatusBadge,
  orderStatusBadge,
  bucketByServiceStatus,
  type Tone,
} from '../lib/suspensionView';

interface Props {
  customers: CustomerServiceView[];
  orders: SuspensionOrder[];
  events: SuspensionEvent[];
  policy: SuspensionPolicy | null;
  userRole: UserRole;
  onRefresh: () => Promise<void>;
  onEvaluateAll: () => Promise<void>;
  onEvaluateCustomer: (id: string) => Promise<void>;
  onUpdatePolicy: (patch: Record<string, unknown>) => Promise<void>;
}

const TONE_CLASS: Record<Tone, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  danger: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  suspended: 'bg-rose-700/20 text-rose-300 border-rose-700/30',
  info: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  neutral: 'bg-slate-700/30 text-slate-300 border-slate-600/30',
};

const COLUMN_ORDER: { status: ServiceStatus; title: string }[] = [
  { status: 'ACTIVE', title: 'Activos' },
  { status: 'WARNING', title: 'Advertencia' },
  { status: 'PENDING_SUSPENSION', title: 'Por suspender' },
  { status: 'SUSPENDED', title: 'Suspendidos' },
  { status: 'PENDING_REACTIVATION', title: 'Por reactivar' },
];

export default function SuspensionModule({
  customers,
  orders,
  events,
  policy,
  userRole,
  onRefresh,
  onEvaluateAll,
  onEvaluateCustomer,
  onUpdatePolicy,
}: Props) {
  const canEvaluate = canEvaluateSuspension(userRole);
  const canPolicy = canManageSuspensionPolicy(userRole);

  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);

  const buckets = bucketByServiceStatus(customers);
  const openOrders = orders.filter((o) => o.status === 'PENDING' || o.status === 'QUEUED');

  const flash = (kind: 'success' | 'error', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const run = async (label: string, fn: () => Promise<void>, okMsg: string) => {
    setBusy(label);
    try {
      await fn();
      flash('success', okMsg);
    } catch (err: any) {
      flash('error', err?.message || 'Operación fallida.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[60] px-4 py-3 rounded-xl border text-xs font-mono shadow-xl ${
            toast.kind === 'success'
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
          }`}
        >
          {toast.msg}
        </div>
      )}
      {busy && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex items-center space-x-2 bg-slate-950 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-mono shadow-xl">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>{busy}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Ban className="w-6 h-6 text-rose-400" />
            <span>Motor de Suspensiones &amp; Cortes</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Decide quién/cuándo se suspende o reactiva y emite ÓRDENES. No ejecuta cortes (eso lo hará el Worker MikroTik).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onRefresh()} className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white" title="Refrescar">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {canEvaluate ? (
            <button
              id="suspension-evaluate-all"
              onClick={() => run('Evaluando cartera...', onEvaluateAll, 'Evaluación completada. Órdenes generadas si aplican.')}
              className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Evaluar toda la cartera</span>
            </button>
          ) : (
            <span className="flex items-center space-x-1.5 text-[11px] bg-slate-800/60 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg font-mono">
              <Lock className="w-3.5 h-3.5" /><span>Solo lectura</span>
            </span>
          )}
        </div>
      </div>

      {/* Buckets */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {COLUMN_ORDER.map((col) => {
          const badge = serviceStatusBadge(col.status);
          return (
            <div key={col.status} className={`p-4 rounded-2xl border ${TONE_CLASS[badge.tone]}`}>
              <span className="text-[10px] uppercase font-mono font-bold tracking-wider block opacity-80">{col.title}</span>
              <span className="text-2xl font-bold font-mono block mt-1">{buckets[col.status]}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Customers */}
        <div className="lg:col-span-7 bg-slate-950 border border-slate-800 rounded-3xl p-5">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-3">
            <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              <span>Estado de Clientes</span>
            </h3>
            <span className="text-[11px] text-slate-500 font-mono">{customers.length} serviceables</span>
          </div>
          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
            {customers.length === 0 ? (
              <div className="text-center py-10 text-slate-500 font-mono text-sm">Sin clientes serviceables.</div>
            ) : (
              customers.map((c) => {
                const svc = serviceStatusBadge(c.serviceStatus);
                const bill = billingStatusBadge(c.billingStatus);
                return (
                  <div key={c.customerId} id={`susp-customer-${c.customerId}`} className="bg-slate-900/40 border border-slate-900 rounded-2xl p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-sm truncate">{c.customerName}</span>
                        <span className="bg-slate-850 text-slate-400 border border-slate-800 font-mono text-[9px] px-1.5 py-0.2 rounded uppercase">{c.customerId}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-1 truncate max-w-[320px]">{c.reason}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${TONE_CLASS[bill.tone]}`}>{bill.label}</span>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${TONE_CLASS[svc.tone]}`}>{svc.label}</span>
                      {canEvaluate && (
                        <button
                          onClick={() => run(`Evaluando ${c.customerName}...`, () => onEvaluateCustomer(c.customerId), 'Cliente evaluado.')}
                          className="text-[10px] bg-slate-800 hover:bg-indigo-600 hover:text-white border border-slate-700 px-2 py-1 rounded-lg font-bold transition"
                        >
                          Evaluar
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column: orders + policy */}
        <div className="lg:col-span-5 space-y-6">
          {/* Orders */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5">
            <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3 mb-3">
              <ClipboardList className="w-4 h-4 text-amber-400" />
              <span>Órdenes Pendientes ({openOrders.length})</span>
            </h3>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {openOrders.length === 0 ? (
                <p className="text-slate-500 text-[11px] italic font-mono">Sin órdenes pendientes.</p>
              ) : (
                openOrders.map((o) => {
                  const ob = orderStatusBadge(o.status);
                  return (
                    <div key={o.id} className="bg-slate-900/40 border border-slate-900 rounded-xl p-2.5 text-[11px] font-mono flex items-center justify-between">
                      <div className="min-w-0">
                        <span className={`font-bold ${o.orderType === 'suspension' ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {o.orderType === 'suspension' ? 'CORTE' : 'REACTIVAR'}
                        </span>
                        <span className="text-slate-400 ml-2">{o.customerId}</span>
                        <span className="text-slate-600 block truncate max-w-[240px]">{o.reason}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${TONE_CLASS[ob.tone]}`}>{ob.label}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Policy */}
          <PolicyPanel policy={policy} canEdit={canPolicy} busy={!!busy} onSave={(patch) => run('Guardando política...', () => onUpdatePolicy(patch), 'Política actualizada.')} />
        </div>
      </div>

      {/* Events */}
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5">
        <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3 mb-3">
          <History className="w-4 h-4 text-indigo-400" />
          <span>Eventos Recientes</span>
        </h3>
        <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
          {events.length === 0 ? (
            <p className="text-slate-500 text-[11px] italic font-mono">Sin eventos. Ejecuta una evaluación.</p>
          ) : (
            events.slice(0, 60).map((e) => (
              <div key={e.id} className="flex items-start justify-between text-[11px] font-mono border-b border-slate-900/40 py-1.5">
                <div className="min-w-0">
                  <span className="text-indigo-400 font-bold uppercase">{e.eventType}</span>
                  <span className="text-slate-400 ml-2">{e.customerId}</span>
                  {e.invoiceId && <span className="text-slate-600 ml-1">({e.invoiceId})</span>}
                  <span className="text-slate-500 block truncate max-w-[640px]">{e.reason}</span>
                </div>
                <span className="text-slate-600 shrink-0">{e.createdAt.substring(0, 16).replace('T', ' ')}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Policy sub-panel ──────────────────────────────────────────────────
function PolicyPanel({
  policy,
  canEdit,
  busy,
  onSave,
}: {
  policy: SuspensionPolicy | null;
  canEdit: boolean;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [grace, setGrace] = useState('');
  if (!policy) {
    return (
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 text-slate-500 text-xs font-mono">Cargando política…</div>
    );
  }
  const toggle = (key: string, value: boolean) => onSave({ [key]: value });
  const Row = ({ k, label, val }: { k: string; label: string; val: boolean }) => (
    <div className="flex items-center justify-between text-[11px] font-mono">
      <span className="text-slate-400">{label}</span>
      <button
        disabled={!canEdit || busy}
        onClick={() => toggle(k, !val)}
        className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
          val ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' : 'bg-slate-700/30 text-slate-400 border-slate-600/30'
        } ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {val ? 'ON' : 'OFF'}
      </button>
    </div>
  );

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-3">
      <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3">
        <Settings className="w-4 h-4 text-slate-400" />
        <span>Política</span>
      </h3>
      <Row k="enabled" label="Motor habilitado" val={policy.enabled} />
      <Row k="suspendAfterDue" label="Suspender tras vencimiento" val={policy.suspendAfterDue} />
      <Row k="reactivateOnPayment" label="Reactivar al pagar" val={policy.reactivateOnPayment} />
      <Row k="reactivateOnPartialPayment" label="Reactivar con pago parcial" val={policy.reactivateOnPartialPayment} />
      <Row k="autoReactivate" label="Auto-reactivación" val={policy.autoReactivate} />
      <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-slate-900">
        <span className="text-slate-400">Días de gracia: <strong className="text-white">{policy.graceDays}</strong></span>
        {canEdit && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min="0"
              max="60"
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
              placeholder={String(policy.graceDays)}
              className="w-16 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-white text-[11px]"
            />
            <button
              disabled={busy || grace === ''}
              onClick={() => { onSave({ graceDays: Number(grace) }); setGrace(''); }}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white px-2 py-1 rounded-lg text-[10px] font-bold"
            >
              Guardar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
