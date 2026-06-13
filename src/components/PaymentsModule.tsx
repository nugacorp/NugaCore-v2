// ====================================================================
// Portal Pagos & Reactivación (Fase 4.8)
// Subfases: 4.8.3 webhooks, 4.8.4 billing integration, 4.8.5 reactivación
// ====================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Banknote,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Loader2,
  Zap,
  FileText,
  ShieldCheck,
  Plus,
} from 'lucide-react';
import type { UserRole } from '../lib/supabase';
import { canWritePayments } from '../lib/paymentsRbac';

// ── Tipos locales ────────────────────────────────────────────────────

type PaymentOrderStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'cancelled';
type PaymentProvider = 'manual' | 'mercado_pago' | 'openpay' | 'spei';

interface PaymentOrderView {
  id: string;
  customerId: string;
  invoiceId: string;
  provider: PaymentProvider;
  providerOrderId?: string;
  amountPesos: number;
  status: PaymentOrderStatus;
  statusLabel: string;
  checkoutUrl?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface MikrotikActionView {
  id: string;
  customerId: string;
  routerId?: string;
  actionType: string;
  status: string;
  dryRun: boolean;
  result?: Record<string, unknown>;
  triggeredBy?: string;
  createdAt: string;
}

interface ReactivationResult {
  customerId: string;
  alreadyActive: boolean;
  mikrotikAction: MikrotikActionView | null;
  message: string;
}

interface CreateOrderForm {
  customerId: string;
  invoiceId: string;
  provider: PaymentProvider;
  amountPesos: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const formatMXN = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(v);

const STATUS_CONFIG: Record<PaymentOrderStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:    { label: 'Pendiente',  color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',    icon: <Clock size={12} /> },
  processing: { label: 'Procesando', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',       icon: <Loader2 size={12} className="animate-spin" /> },
  completed:  { label: 'Completado', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', icon: <CheckCircle size={12} /> },
  failed:     { label: 'Fallido',    color: 'text-rose-400 bg-rose-500/10 border-rose-500/20',       icon: <XCircle size={12} /> },
  expired:    { label: 'Expirado',   color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',    icon: <AlertTriangle size={12} /> },
  cancelled:  { label: 'Cancelado',  color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',    icon: <XCircle size={12} /> },
};

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  manual: 'Manual',
  mercado_pago: 'MercadoPago',
  openpay: 'OpenPay',
  spei: 'SPEI',
};

const canWrite = canWritePayments;

// ── Componente principal ──────────────────────────────────────────────

interface PaymentsModuleProps {
  userRole: UserRole | string | null;
}

export default function PaymentsModule({ userRole }: PaymentsModuleProps) {
  const [orders, setOrders] = useState<PaymentOrderView[]>([]);
  const [actions, setActions] = useState<MikrotikActionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeTab, setActiveTab] = useState<'orders' | 'actions'>('orders');

  // Formulario de nueva orden
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<CreateOrderForm>({
    customerId: '', invoiceId: '', provider: 'manual', amountPesos: '',
  });
  const [formLoading, setFormLoading] = useState(false);

  // Reactivación manual
  const [reactivateId, setReactivateId] = useState('');
  const [reactivating, setReactivating] = useState(false);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'x-user-role': userRole || 'solo lectura',
    'x-user-id': 'client',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ordersRes, actionsRes] = await Promise.all([
        fetch('/api/payments/orders', { headers: authHeaders() }),
        fetch('/api/payments/actions', { headers: authHeaders() }),
      ]);
      if (ordersRes.ok) setOrders(await ordersRes.json());
      if (actionsRes.ok) setActions(await actionsRes.json());
    } catch {
      setError('Error al cargar datos de pagos.');
    } finally {
      setLoading(false);
    }
  }, [userRole]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerId || !formData.invoiceId || !formData.amountPesos) return;
    setFormLoading(true);
    try {
      const res = await fetch('/api/payments/orders', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          customerId: formData.customerId,
          invoiceId: formData.invoiceId,
          provider: formData.provider,
          amountCents: Math.round(parseFloat(formData.amountPesos) * 100),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al crear orden.');
      }
      const order = await res.json();
      setOrders((prev) => [order, ...prev]);
      setNotice(`Orden ${order.id} creada con ${PROVIDER_LABELS[order.provider]}.`);
      setShowForm(false);
      setFormData({ customerId: '', invoiceId: '', provider: 'manual', amountPesos: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido.');
    } finally {
      setFormLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!reactivateId.trim()) return;
    setReactivating(true);
    setError('');
    try {
      const res = await fetch(`/api/payments/customers/${reactivateId.trim()}/reactivate`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Error al reactivar.');
      }
      const result: ReactivationResult = await res.json();
      setNotice(result.message);
      if (result.mikrotikAction) setActions((prev) => [result.mikrotikAction!, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al reactivar.');
    } finally {
      setReactivating(false);
      setReactivateId('');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Banknote size={20} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Portal Pagos & Reactivación</h2>
            <p className="text-xs text-slate-400">Payment Engine — Fase 4.8 · Reactivación lógica (dry_run)</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canWrite(userRole) && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg transition-colors"
            >
              <Plus size={12} /> Nueva Orden
            </button>
          )}
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700/50 hover:bg-slate-700 text-slate-300 border border-slate-600/50 rounded-lg transition-colors"
          >
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>
      </div>

      {/* Notice / Error */}
      {notice && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <CheckCircle size={14} /> {notice}
          <button onClick={() => setNotice('')} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Formulario nueva orden */}
      {showForm && canWrite(userRole) && (
        <form onSubmit={handleCreateOrder} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-3">
          <h3 className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
            <Plus size={14} className="text-emerald-400" /> Nueva Payment Order
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Customer ID</label>
              <input value={formData.customerId} onChange={(e) => setFormData((f) => ({ ...f, customerId: e.target.value }))}
                placeholder="c-4" required
                className="w-full px-3 py-1.5 text-xs bg-slate-900/50 border border-slate-600/50 text-slate-200 rounded-lg focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Invoice ID</label>
              <input value={formData.invoiceId} onChange={(e) => setFormData((f) => ({ ...f, invoiceId: e.target.value }))}
                placeholder="fac-103" required
                className="w-full px-3 py-1.5 text-xs bg-slate-900/50 border border-slate-600/50 text-slate-200 rounded-lg focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Proveedor</label>
              <select value={formData.provider} onChange={(e) => setFormData((f) => ({ ...f, provider: e.target.value as PaymentProvider }))}
                className="w-full px-3 py-1.5 text-xs bg-slate-900/50 border border-slate-600/50 text-slate-200 rounded-lg focus:outline-none focus:border-emerald-500/50"
              >
                <option value="manual">Manual</option>
                <option value="mercado_pago">MercadoPago</option>
                <option value="openpay">OpenPay</option>
                <option value="spei">SPEI</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Monto (MXN)</label>
              <input value={formData.amountPesos} onChange={(e) => setFormData((f) => ({ ...f, amountPesos: e.target.value }))}
                placeholder="299.00" type="number" step="0.01" min="0.01" required
                className="w-full px-3 py-1.5 text-xs bg-slate-900/50 border border-slate-600/50 text-slate-200 rounded-lg focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors">Cancelar</button>
            <button type="submit" disabled={formLoading}
              className="flex items-center gap-1 px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {formLoading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Crear Orden
            </button>
          </div>
        </form>
      )}

      {/* Reactivación manual */}
      {canWrite(userRole) && (
        <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
          <h3 className="text-sm font-medium text-slate-200 flex items-center gap-1.5 mb-3">
            <Zap size={14} className="text-amber-400" /> Reactivación Lógica Manual
          </h3>
          <div className="flex gap-2">
            <input
              value={reactivateId}
              onChange={(e) => setReactivateId(e.target.value)}
              placeholder="Customer ID (ej: c-4)"
              className="flex-1 px-3 py-1.5 text-xs bg-slate-900/50 border border-slate-600/50 text-slate-200 rounded-lg focus:outline-none focus:border-amber-500/50"
            />
            <button
              onClick={handleReactivate}
              disabled={reactivating || !reactivateId.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg transition-colors disabled:opacity-50"
            >
              {reactivating ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />} Reactivar
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
            <ShieldCheck size={10} /> dry_run=true — No ejecuta en router real
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-800/50 rounded-xl border border-slate-700/50 w-fit">
        {(['orders', 'actions'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab === 'orders' ? (
              <span className="flex items-center gap-1.5"><FileText size={11} /> Órdenes ({orders.length})</span>
            ) : (
              <span className="flex items-center gap-1.5"><Zap size={11} /> Acciones MikroTik ({actions.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 size={20} className="animate-spin mr-2" /> Cargando...
        </div>
      ) : activeTab === 'orders' ? (
        <OrdersList orders={orders} />
      ) : (
        <ActionsList actions={actions} />
      )}
    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────

function OrdersList({ orders }: { orders: PaymentOrderView[] }) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <Banknote size={32} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">No hay órdenes de pago.</p>
        <p className="text-xs mt-1">Crea una orden para iniciar el flujo de pago.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {orders.map((order) => {
        const cfg = STATUS_CONFIG[order.status];
        return (
          <div key={order.id} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-slate-600/50 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-slate-400">{order.id}</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border rounded-full ${cfg.color}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                  <span className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded-full">
                    {PROVIDER_LABELS[order.provider]}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs text-slate-400">
                  <span>Cliente: <span className="text-slate-300">{order.customerId}</span></span>
                  <span>Factura: <span className="text-slate-300">{order.invoiceId}</span></span>
                  <span>Monto: <span className="text-emerald-400 font-medium">{formatMXN(order.amountPesos)}</span></span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {order.checkoutUrl && (
                  <a href={order.checkoutUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2 py-1 text-[10px] text-blue-400 border border-blue-500/20 rounded-lg hover:bg-blue-500/10 transition-colors"
                  >
                    <ExternalLink size={10} /> Checkout
                  </a>
                )}
                <span className="text-[10px] text-slate-500">{order.createdAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionsList({ actions }: { actions: MikrotikActionView[] }) {
  if (actions.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <Zap size={32} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">No hay acciones MikroTik pendientes.</p>
        <p className="text-xs mt-1">Las acciones se crean al confirmar un pago.</p>
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    pending:   'text-amber-400 bg-amber-500/10 border-amber-500/20',
    executing: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    failed:    'text-rose-400 bg-rose-500/10 border-rose-500/20',
    skipped:   'text-slate-400 bg-slate-500/10 border-slate-500/20',
  };

  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <div key={action.id} className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs text-slate-400">{action.id}</span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border rounded-full ${statusColor[action.status] ?? ''}`}>
                  {action.status}
                </span>
                <span className="text-[10px] text-slate-300 bg-slate-700/50 px-1.5 py-0.5 rounded-full capitalize">
                  {action.actionType}
                </span>
                {action.dryRun && (
                  <span className="text-[10px] text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <ShieldCheck size={9} /> dry_run
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-x-4 text-xs text-slate-400">
                <span>Cliente: <span className="text-slate-300">{action.customerId}</span></span>
                {action.routerId && <span>Router: <span className="text-slate-300">{action.routerId}</span></span>}
                {action.triggeredBy && <span>Por: <span className="text-slate-300 truncate">{action.triggeredBy}</span></span>}
              </div>
            </div>
            <span className="text-[10px] text-slate-500 shrink-0">{action.createdAt.slice(0, 16).replace('T', ' ')}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
