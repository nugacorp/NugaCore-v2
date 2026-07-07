import React, { useState, useEffect } from 'react';
import { getErrorMessage } from '../lib/errors';
import { createAuthorizedApi } from '../lib/apiClient';
import {
  FileText,
  Zap,
  Plus,
  Edit,
  Coins,
  Lock,
  Ban,
  Loader2,
  CheckCircle,
  AlertTriangle,
  BarChart3,
  Wallet,
  HandCoins,
  Calendar,
} from 'lucide-react';
import {
  Invoice,
  Client,
  BillingAccountSummary,
  BillingRevenueReport,
  AccountStateResponse,
} from '../types';
import type { UserRole } from '../lib/supabase';
import { canManageBilling } from '../lib/billingRbac';
import {
  formatMXN,
  paidAmountOf,
  pendingAmountOf,
  statusBadge,
  isPayable,
  deriveSummary,
  resolvePaymentAmount,
  type BillingBadgeTone,
} from '../lib/billingView';

interface BillingModuleProps {
  invoices: Invoice[];
  clients: Client[];
  summary: BillingAccountSummary | null;
  revenueReport: BillingRevenueReport | null;
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onPayInvoice: (id: string, method: string, amount?: number) => Promise<void>;
  onCreateInvoice: (invoiceData: any) => Promise<void>;
  onEditInvoice: (id: string, invoiceData: any) => Promise<void>;
  onFetchAccountState: (id: string) => Promise<AccountStateResponse>;
}

interface PaymentPromiseRow {
  id: string;
  clientId: string;
  promisedDate: string;
  amountCents: number;
  status: string;
  blocksSuspension: boolean;
  notes?: string;
}

interface CashRegisterSummary {
  date: string;
  totalCents: number;
  entries: { id: string; amountCents: number; paymentMethod: string; clientName?: string; notes?: string }[];
}

const BADGE_CLASS: Record<BillingBadgeTone, string> = {
  paid: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  unpaid: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  overdue: 'bg-rose-500/15 text-rose-400 border-rose-500/20 animate-pulse',
  canceled: 'bg-slate-700/40 text-slate-400 border-slate-600/40 line-through',
  partial: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
};

type Toast = { kind: 'success' | 'error'; msg: string } | null;
type Confirm = { message: string; confirmLabel: string; onConfirm: () => void } | null;

export default function BillingModule({
  invoices,
  clients,
  summary,
  revenueReport,
  userRole,
  getAuthHeaders,
  onPayInvoice,
  onCreateInvoice,
  onEditInvoice,
  onFetchAccountState,
}: BillingModuleProps) {
  const canManage = canManageBilling(userRole);

  const [billingTab, setBillingTab] = useState<'invoices' | 'collections'>('invoices');
  const [promises, setPromises] = useState<PaymentPromiseRow[]>([]);
  const [cashRegister, setCashRegister] = useState<CashRegisterSummary | null>(null);
  const [promiseClientId, setPromiseClientId] = useState('');
  const [promiseDate, setPromiseDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().split('T')[0];
  });
  const [promiseAmount, setPromiseAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [cashMethod, setCashMethod] = useState('Efectivo');
  const [cyclePreview, setCyclePreview] = useState<{ wouldGenerate: number; customersProcessed: number } | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [payGateway, setPayGateway] = useState('Stripe');
  const [payAmount, setPayAmount] = useState('');
  const [payAmountError, setPayAmountError] = useState('');
  const [paymentInProgress, setPaymentInProgress] = useState(false);

  // Async UX state
  const [toast, setToast] = useState<Toast>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busyLabel, setBusyLabel] = useState<string>('');

  // Account state (per-invoice ledger)
  const [accountState, setAccountState] = useState<AccountStateResponse | null>(null);
  const [accountStateLoading, setAccountStateLoading] = useState(false);

  // Revenue report panel toggle
  const [showRevenue, setShowRevenue] = useState(false);

  // Invoice creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formClientId, setFormClientId] = useState('');
  const [formConcept, setFormConcept] = useState('Suscripción Mensual Internet Banda Ancha');
  const [formAmount, setFormAmount] = useState('449');
  const [formDueDate, setFormDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().split('T')[0];
  });

  // Invoice edit state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editConcept, setEditConcept] = useState('');
  const [editAmount, setEditAmount] = useState('449');
  const [editDueDate, setEditDueDate] = useState('');

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadCollections = async () => {
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const [promRes, cashRes] = await Promise.all([
        api.get<PaymentPromiseRow[]>('/api/collections/promises?status=active'),
        api.get<CashRegisterSummary>('/api/collections/cash-register'),
      ]);
      setPromises(promRes);
      setCashRegister(cashRes);
    } catch {
      setPromises([]);
      setCashRegister(null);
    }
  };

  useEffect(() => {
    if (billingTab === 'collections') void loadCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingTab]);

  const submitPromise = async () => {
    if (!promiseClientId || !promiseAmount) return;
    setBusyLabel('Registrando promesa...');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.post('/api/collections/promises', {
        clientId: promiseClientId,
        promisedDate: promiseDate,
        amount: Number(promiseAmount),
        blocksSuspension: true,
      });
      setToast({ kind: 'success', msg: 'Promesa de pago registrada.' });
      setPromiseAmount('');
      await loadCollections();
    } catch (err) {
      setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo registrar la promesa.') });
    } finally {
      setBusyLabel('');
    }
  };

  const submitCashEntry = async () => {
    const amount = Number(cashAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBusyLabel('Registrando en caja...');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.post('/api/collections/cash-register/entries', {
        amountCents: Math.round(amount * 100),
        paymentMethod: cashMethod,
        notes: 'Caja del día',
      });
      setToast({ kind: 'success', msg: 'Entrada registrada en caja.' });
      setCashAmount('');
      await loadCollections();
    } catch (err) {
      setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo registrar en caja.') });
    } finally {
      setBusyLabel('');
    }
  };

  const runBillingCyclePreview = async () => {
    setBusyLabel('Simulando ciclo...');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const res = await api.post<{ wouldGenerate: number; customersProcessed: number }>('/api/billing/run-cycle', { period: 'monthly' });
      setCyclePreview(res);
      setToast({ kind: 'success', msg: `Ciclo simulado: ${res.wouldGenerate} facturas proyectadas.` });
    } catch (err) {
      setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo simular el ciclo.') });
    } finally {
      setBusyLabel('');
    }
  };

  // Keep the selected invoice in sync with refreshed data; reload account state.
  useEffect(() => {
    if (!selectedInvoice) {
      setAccountState(null);
      return;
    }
    const fresh = invoices.find((i) => i.id === selectedInvoice.id) || null;
    if (fresh && fresh !== selectedInvoice) setSelectedInvoice(fresh);

    let cancelled = false;
    setAccountStateLoading(true);
    setAccountState(null);
    onFetchAccountState(selectedInvoice.id)
      .then((state) => {
        if (!cancelled) setAccountState(state);
      })
      .catch(() => {
        if (!cancelled) setAccountState(null);
      })
      .finally(() => {
        if (!cancelled) setAccountStateLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice?.id, invoices]);

  const filteredInvoices = invoices.filter((inv) => {
    const matchesSearch =
      inv.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || inv.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Resumen canónico del backend; fallback al cálculo en cliente si aún no llega.
  const view = summary ?? deriveSummary(invoices);

  // ── Acciones async ────────────────────────────────────────────────────
  const runPayment = async (inv: Invoice) => {
    setPaymentInProgress(true);
    setBusyLabel('Registrando pago...');
    const { amount } = resolvePaymentAmount(inv, payAmount);
    try {
      await onPayInvoice(inv.id, payGateway, payAmount.trim() ? amount : undefined);
      setToast({ kind: 'success', msg: `Pago de ${formatMXN(amount)} registrado en ${inv.id}.` });
      setPayAmount('');
    } catch (err) {
      setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo registrar el pago.') });
    } finally {
      setPaymentInProgress(false);
      setBusyLabel('');
    }
  };

  const requestPayment = (inv: Invoice) => {
    setPayAmountError('');
    const { amount, error } = resolvePaymentAmount(inv, payAmount);
    if (error) {
      setPayAmountError(error);
      return;
    }
    setConfirm({
      message: `¿Registrar pago de ${formatMXN(amount)} para la factura ${inv.id} (${inv.clientName}) vía ${payGateway}?`,
      confirmLabel: 'Registrar pago',
      onConfirm: () => runPayment(inv),
    });
  };

  const requestCancel = (inv: Invoice) => {
    setConfirm({
      message: `¿Cancelar la factura ${inv.id} de ${inv.clientName}? Esta acción marca la factura como cancelada.`,
      confirmLabel: 'Cancelar factura',
      onConfirm: async () => {
        setBusyLabel('Cancelando factura...');
        try {
          await onEditInvoice(inv.id, { status: 'canceled' });
          setToast({ kind: 'success', msg: `Factura ${inv.id} cancelada.` });
        } catch (err) {
          setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo cancelar la factura.') });
        } finally {
          setBusyLabel('');
        }
      },
    });
  };

  const handleCreateInvoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClientId || !formAmount) return;
    setBusyLabel('Creando factura...');
    try {
      await onCreateInvoice({
        clientId: formClientId,
        amount: Number(formAmount),
        dueDateStr: formDueDate,
        items: [{ description: formConcept, price: Number(formAmount), qty: 1 }],
      });
      setToast({ kind: 'success', msg: 'Factura creada correctamente.' });
      setFormClientId('');
      setFormConcept('Suscripción Mensual Internet Banda Ancha');
      setFormAmount('449');
      setShowCreateModal(false);
    } catch (err) {
      setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo crear la factura.') });
    } finally {
      setBusyLabel('');
    }
  };

  const submitEdit = async () => {
    if (!selectedInvoice) return;
    setBusyLabel('Guardando cambios...');
    try {
      await onEditInvoice(selectedInvoice.id, {
        amount: Number(editAmount),
        dueDateStr: editDueDate,
        items: [{ description: editConcept, price: Number(editAmount), qty: 1 }],
      });
      setToast({ kind: 'success', msg: `Factura ${selectedInvoice.id} actualizada.` });
      setShowEditModal(false);
    } catch (err) {
      setToast({ kind: 'error', msg: getErrorMessage(err, 'No se pudo editar la factura.') });
    } finally {
      setBusyLabel('');
    }
  };

  const handleEditInvoiceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;
    setConfirm({
      message: `¿Guardar cambios en la factura ${selectedInvoice.id}? Nuevo total: ${formatMXN(Number(editAmount))}.`,
      confirmLabel: 'Guardar cambios',
      onConfirm: submitEdit,
    });
  };

  const openEditModal = (inv: Invoice) => {
    setEditConcept(inv.items[0]?.description || 'Suscripción Mensual Internet Banda Ancha');
    setEditAmount(String(inv.amount));
    setEditDueDate(inv.dueDateStr);
    setShowEditModal(true);
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Tab bar: Facturas | Cobranza operativa */}
      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          id="billing-tab-invoices"
          onClick={() => setBillingTab('invoices')}
          className={`px-4 py-2 rounded-t-xl text-xs font-mono uppercase ${billingTab === 'invoices' ? 'bg-slate-950 text-indigo-300 border border-b-0 border-slate-800' : 'text-slate-500'}`}
        >
          Facturas
        </button>
        <button
          type="button"
          id="billing-tab-collections"
          onClick={() => setBillingTab('collections')}
          className={`px-4 py-2 rounded-t-xl text-xs font-mono uppercase flex items-center gap-1 ${billingTab === 'collections' ? 'bg-slate-950 text-indigo-300 border border-b-0 border-slate-800' : 'text-slate-500'}`}
        >
          <Wallet className="w-3.5 h-3.5" /> Cobranza
        </button>
      </div>

      {billingTab === 'collections' && (
        <div id="billing-collections-panel" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><HandCoins className="w-4 h-4 text-amber-400" /> Promesas de pago activas</h3>
            {promises.length === 0 ? (
              <p className="text-xs text-slate-500">No hay promesas activas.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {promises.map((p) => (
                  <li key={p.id} className="flex justify-between border border-slate-800 rounded-lg px-3 py-2">
                    <span>{clients.find((c) => c.id === p.clientId)?.name || p.clientId}</span>
                    <span className="text-amber-300 font-mono">{formatMXN(p.amountCents / 100)} · {p.promisedDate}</span>
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="border-t border-slate-800 pt-3 space-y-2 text-xs">
                <p className="text-slate-500 font-mono uppercase text-[10px]">Nueva promesa</p>
                <select value={promiseClientId} onChange={(e) => setPromiseClientId(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2">
                  <option value="">Cliente...</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <input type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-2" />
                  <input type="number" placeholder="Monto" value={promiseAmount} onChange={(e) => setPromiseAmount(e.target.value)} className="w-28 bg-slate-900 border border-slate-800 rounded-lg p-2" />
                </div>
                <button type="button" disabled={!!busyLabel} onClick={() => void submitPromise()} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg font-semibold">Registrar promesa</button>
              </div>
            )}
          </section>
          <section className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Calendar className="w-4 h-4 text-emerald-400" /> Caja del día</h3>
            <p className="text-2xl font-mono text-emerald-400">{formatMXN((cashRegister?.totalCents ?? 0) / 100)}</p>
            <p className="text-[10px] text-slate-500 font-mono">{cashRegister?.date ?? '—'} · {(cashRegister?.entries ?? []).length} movimientos</p>
            {canManage && (
              <div className="border-t border-slate-800 pt-3 space-y-2 text-xs">
                <div className="flex gap-2">
                  <input type="number" placeholder="Monto" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg p-2" />
                  <select value={cashMethod} onChange={(e) => setCashMethod(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg p-2">
                    <option>Efectivo</option><option>Transferencia</option><option>Tarjeta</option>
                  </select>
                </div>
                <button type="button" disabled={!!busyLabel} onClick={() => void submitCashEntry()} className="w-full bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 py-2 rounded-lg font-semibold">Agregar a caja</button>
              </div>
            )}
            {canManage && (
              <div className="border-t border-slate-800 pt-3">
                <button type="button" disabled={!!busyLabel} onClick={() => void runBillingCyclePreview()} className="w-full flex items-center justify-center gap-2 bg-slate-900 border border-slate-800 py-2 rounded-lg text-xs text-slate-300">
                  <Zap className="w-3.5 h-3.5" /> Simular ciclo de facturación
                </button>
                {cyclePreview && (
                  <p className="text-[10px] text-slate-500 mt-2 font-mono">
                    Proyección: {cyclePreview.wouldGenerate} facturas / {cyclePreview.customersProcessed} clientes
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Toast / notice — global */}
      {toast && (
        <div
          id="billing-toast"
          className={`fixed top-5 right-5 z-[60] flex items-center space-x-2 px-4 py-3 rounded-xl border text-xs font-mono shadow-xl ${
            toast.kind === 'success'
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          <span>{toast.msg}</span>
        </div>
      )}

      {billingTab === 'invoices' && (
    <>

      {/* Global busy banner */}
      {busyLabel && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex items-center space-x-2 bg-slate-950 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-mono shadow-xl">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>{busyLabel}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Facturación Fiscal &amp; Cobros</h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Cobranza conectada a Billing persistente. Crea facturas, registra pagos (totales o parciales) y consulta estado de cuenta real.
          </p>
        </div>
        <div className="flex items-center space-x-2 flex-wrap gap-2">
          {canManage ? (
            <button
              onClick={() => setShowCreateModal(true)}
              id="emitir-factura-btn"
              className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition shadow-lg shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Emitir Factura / Cargo</span>
            </button>
          ) : (
            <span className="flex items-center space-x-1.5 text-xs bg-slate-800/60 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg font-mono">
              <Lock className="w-3.5 h-3.5" />
              <span>Modo solo lectura</span>
            </span>
          )}
          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg font-mono text-center">
            Billing DB: ONLINE
          </span>
        </div>
      </div>

      {/* Stats / resumen de cobranza (account-summary) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        <div className="md:col-span-4 bg-emerald-500 rounded-3xl p-6 text-slate-950 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-80">Total Pendiente por Cobrar</h3>
            <p id="billing-kpi-pending" className="text-4xl font-extrabold mt-3 tracking-tight">
              {formatMXN(view.totalPending)}
            </p>
            <div className="bg-slate-950/20 p-4 rounded-xl mt-3 text-xs border border-white/10">
              <div className="flex justify-between items-center font-bold">
                <span>Cobrado</span>
                <span className="bg-slate-950 text-white px-2 py-0.5 rounded text-[10px]">
                  {formatMXN(view.totalCollected)}
                </span>
              </div>
              <p className="mt-1 opacity-90">
                {view.invoicesCount} facturas · {view.paidCount} pagadas · {view.overdueCount} vencidas
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowRevenue((s) => !s)}
            className="mt-6 w-full bg-slate-950 hover:bg-slate-900 text-white py-3 rounded-2xl text-xs font-bold transition font-mono uppercase tracking-widest text-center flex items-center justify-center space-x-2"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>{showRevenue ? 'Ocultar' : 'Ver'} Reporte de Ingresos</span>
          </button>
        </div>

        <div className="md:col-span-8 bg-slate-950 p-6 rounded-3xl border border-slate-800 flex flex-col justify-between">
          <div className="space-y-4">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-mono font-bold">Resumen de Cuenta (Billing DB)</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900">
                <span className="text-[10px] text-slate-500 block uppercase font-mono">Total Facturado</span>
                <span className="text-xl font-bold font-mono text-white">{formatMXN(view.totalInvoiced)}</span>
                <span className="text-[9px] text-slate-500 block mt-1">{view.invoicesCount} folios emitidos</span>
              </div>
              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900">
                <span className="text-[10px] text-slate-400 block uppercase font-mono">Total Cobrado</span>
                <span className="text-xl font-bold font-mono text-emerald-400">{formatMXN(view.totalCollected)}</span>
                <span className="text-[9px] text-emerald-500/80 block mt-1">{view.paidCount} pagadas</span>
              </div>
              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900">
                <span className="text-[10px] text-slate-400 block uppercase font-mono">Vencidas</span>
                <span className="text-xl font-bold font-mono text-rose-400">{view.overdueCount}</span>
                <span className="text-[9px] text-rose-400/80 block mt-1">{view.unpaidCount} pendientes</span>
              </div>
            </div>
          </div>

          {showRevenue && (
            <div id="billing-revenue-report" className="bg-slate-900/40 p-4 rounded-2xl border border-slate-900 mt-4 space-y-3">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-bold flex items-center space-x-2">
                <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Reporte de Ingresos</span>
              </span>
              {!revenueReport ? (
                <p className="text-[11px] text-slate-500 italic">Cargando reporte de ingresos...</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-mono block mb-1.5">Ingresos por Método</span>
                    {revenueReport.byMethod.length === 0 ? (
                      <p className="text-slate-600 text-[11px] italic">Sin pagos registrados.</p>
                    ) : (
                      <div className="space-y-1">
                        {revenueReport.byMethod.map((m) => (
                          <div key={m.method} className="flex justify-between font-mono text-slate-300">
                            <span>{m.method}</span>
                            <span className="text-emerald-400 font-bold">{formatMXN(m.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-mono block mb-1.5">Top Facturas Pendientes (deudores)</span>
                    {revenueReport.topPendingInvoices.length === 0 ? (
                      <p className="text-slate-600 text-[11px] italic">Sin facturas pendientes.</p>
                    ) : (
                      <div className="space-y-1">
                        {revenueReport.topPendingInvoices.slice(0, 5).map((inv) => (
                          <div key={inv.id} className="flex justify-between font-mono text-slate-300">
                            <span className="truncate max-w-[150px]">{inv.clientName}</span>
                            <span className="text-rose-400 font-bold">{formatMXN(pendingAmountOf(inv))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!showRevenue && (
            <div className="bg-slate-900/40 p-4 rounded-2xl border border-slate-900 text-xs text-slate-400 leading-relaxed mt-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Los pagos se persisten en Billing DB. Selecciona una factura para ver su estado de cuenta y registrar cobros parciales o totales.</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ledger + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Invoice list */}
        <div className="lg:col-span-7 bg-slate-950 p-5 rounded-3xl border border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between border-b border-slate-900 pb-4 mb-4">
            <p className="text-sm font-bold text-white tracking-wide">Registro de Facturas Emitidas</p>
            <div className="flex gap-2">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar cliente / folio"
                className="bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-xl px-2.5 py-1.5 focus:outline-none"
              />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-xl px-2.5 py-1.5 focus:outline-none"
              >
                <option value="all">Ver todas</option>
                <option value="paid">Pagadas</option>
                <option value="unpaid">Sin Pagar</option>
                <option value="overdue">Vencidas</option>
                <option value="canceled">Canceladas</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[440px] overflow-y-auto pr-1">
            {filteredInvoices.length === 0 ? (
              <div id="billing-empty-state" className="text-center py-12 text-slate-500 font-mono">
                <FileText className="w-10 h-10 text-slate-800 mx-auto mb-3" />
                <p className="text-sm">
                  {invoices.length === 0
                    ? 'Sin facturas registradas todavía.'
                    : 'Ninguna factura coincide con el filtro.'}
                </p>
              </div>
            ) : (
              filteredInvoices.map((inv) => {
                const badge = statusBadge(inv);
                const pending = pendingAmountOf(inv);
                const paid = paidAmountOf(inv);
                return (
                  <div
                    key={inv.id}
                    id={`billing-invoice-box-${inv.id}`}
                    onClick={() => setSelectedInvoice(inv)}
                    className={`p-3.5 rounded-2xl border text-xs cursor-pointer transition flex items-center justify-between ${
                      selectedInvoice?.id === inv.id
                        ? 'bg-slate-900 border-indigo-500/50'
                        : 'bg-slate-900/40 border-slate-900 hover:border-slate-800'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white text-sm">{inv.clientName}</span>
                        <span className="bg-slate-850 text-slate-400 border border-slate-800 font-mono text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase">
                          ID: {inv.id}
                        </span>
                      </div>
                      <div className="text-slate-400 font-mono text-[10px]">
                        Vence: <span className="text-slate-300">{inv.dueDateStr}</span>
                        {badge.tone === 'partial' && (
                          <span className="text-sky-400 block text-[10px] mt-0.5">
                            Pagado {formatMXN(paid)} · Resta {formatMXN(pending)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right space-y-1.5">
                      <span className="font-bold font-mono text-sm text-white block">{formatMXN(inv.amount)}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase inline-block border ${BADGE_CLASS[badge.tone]}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Detail / account state / pay */}
        <div className="lg:col-span-5">
          {selectedInvoice ? (
            <div id="billing-detail-wizard" className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <div>
                  <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded">
                    Estado de Cuenta
                  </span>
                  <h4 className="text-base font-bold text-white mt-1.5">Factura {selectedInvoice.id}</h4>
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="text-slate-500 hover:text-white font-bold">✕</button>
              </div>

              <div className="space-y-4 text-xs font-mono">
                {/* Client + totals */}
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-900 space-y-2">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-semibold">Cliente Receptor</span>
                    <span className="text-sm font-semibold text-white block mt-0.5">{selectedInvoice.clientName}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-900">
                    <div>
                      <span className="text-[9px] text-slate-500 uppercase block">Total</span>
                      <span className="text-white font-bold block">{formatMXN(selectedInvoice.amount)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 uppercase block">Pagado</span>
                      <span id="billing-detail-paid" className="text-emerald-400 font-bold block">{formatMXN(paidAmountOf(selectedInvoice))}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 uppercase block">Pendiente</span>
                      <span id="billing-detail-pending" className="text-amber-400 font-bold block">{formatMXN(pendingAmountOf(selectedInvoice))}</span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-900 flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 uppercase">Vencimiento</span>
                    <span className="text-slate-300">{selectedInvoice.dueDateStr}</span>
                  </div>
                </div>

                {/* Concepts */}
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold mb-2">Conceptos</span>
                  {selectedInvoice.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between text-slate-300 py-1 border-b border-slate-900">
                      <span className="truncate max-w-[200px]">{it.description}</span>
                      <span className="font-semibold text-slate-100">{formatMXN(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>

                {/* Pagos aplicados (account-state) */}
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold mb-2">Pagos Aplicados</span>
                  {accountStateLoading ? (
                    <p className="text-slate-500 text-[11px] italic flex items-center space-x-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Cargando estado de cuenta...</span>
                    </p>
                  ) : accountState && accountState.allocations.length > 0 ? (
                    <div className="space-y-1.5">
                      {accountState.allocations.map((a) => (
                        <div key={a.id} className="bg-slate-900/40 p-3 rounded-xl border border-slate-900/50 space-y-1">
                          <div className="flex justify-between items-center text-slate-200">
                            <span className="font-bold">{a.method}</span>
                            <span className="text-emerald-400 text-[11px] font-bold">{formatMXN(a.amount)}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 flex justify-between">
                            <span>{a.paymentDate?.substring(0, 16).replace('T', ' ')}</span>
                            <span>Resta: {formatMXN(a.remainingAfterPayment)}</span>
                          </div>
                          {a.transactionId && (
                            <div className="text-[9px] text-indigo-400 truncate">TXN: {a.transactionId}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-500 text-[11px] italic">Esta factura aún no tiene pagos aplicados.</p>
                  )}
                </div>

                {/* Acciones (RBAC visual) */}
                {canManage && isPayable(selectedInvoice) && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openEditModal(selectedInvoice)}
                        className="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-bold transition text-[11px] flex items-center justify-center space-x-1 border border-slate-700"
                      >
                        <Edit className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Editar</span>
                      </button>
                      <button
                        onClick={() => requestCancel(selectedInvoice)}
                        className="py-2.5 bg-slate-800 hover:bg-rose-600/30 text-slate-200 rounded-xl font-bold transition text-[11px] flex items-center justify-center space-x-1 border border-slate-700"
                      >
                        <Ban className="w-3.5 h-3.5 text-rose-400" />
                        <span>Cancelar</span>
                      </button>
                    </div>

                    <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                      <span className="text-slate-400 font-bold uppercase text-[9px] font-mono block">Registrar Pago (Caja / Conciliación)</span>

                      <div className="space-y-1.5">
                        <label className="text-[9px] text-slate-500 uppercase block">Monto (vacío = saldo completo {formatMXN(pendingAmountOf(selectedInvoice))})</label>
                        <input
                          id="billing-pay-amount"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={String(pendingAmountOf(selectedInvoice))}
                          value={payAmount}
                          onChange={(e) => {
                            setPayAmount(e.target.value);
                            setPayAmountError('');
                          }}
                          className="w-full bg-slate-950 text-white border border-slate-800 rounded-xl p-2.5 font-mono text-xs"
                        />
                        {payAmountError && <p className="text-[10px] text-rose-400">{payAmountError}</p>}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {['Stripe', 'Mercado Pago', 'PayPal', 'OXXO', 'SPEI'].map((gw) => (
                          <button
                            key={gw}
                            type="button"
                            onClick={() => setPayGateway(gw)}
                            className={`py-1.5 rounded-lg font-mono text-[10px] transition font-bold border ${
                              payGateway === gw
                                ? 'bg-indigo-600 border-indigo-500 text-white'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {gw}
                          </button>
                        ))}
                      </div>

                      <button
                        id="submit-payment-btn"
                        onClick={() => requestPayment(selectedInvoice)}
                        disabled={paymentInProgress}
                        className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 font-bold font-mono text-xs flex items-center justify-center space-x-1.5 transition uppercase tracking-widest shadow-lg shadow-emerald-500/15"
                      >
                        {paymentInProgress ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Procesando...</span>
                          </>
                        ) : (
                          <>
                            <Coins className="w-3.5 h-3.5" />
                            <span>Registrar Pago {payGateway}</span>
                          </>
                        )}
                      </button>
                      <p className="text-[9px] text-slate-500 leading-normal text-center">
                        Pasarelas en simulación (sin pago en línea). El cobro se persiste en Billing DB.
                      </p>
                    </div>
                  </>
                )}

                {canManage && !isPayable(selectedInvoice) && selectedInvoice.status === 'paid' && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl p-3 text-[11px] text-center">
                    Factura liquidada por completo.
                  </div>
                )}
                {selectedInvoice.status === 'canceled' && (
                  <div className="bg-slate-800/40 border border-slate-700/40 text-slate-400 rounded-xl p-3 text-[11px] text-center">
                    Factura cancelada.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center py-12 text-slate-500 font-mono">
              <FileText className="w-12 h-12 text-slate-850 mx-auto mb-3" />
              <p className="text-sm">Selecciona una factura para ver su estado de cuenta y registrar pagos.</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {confirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Confirmar acción</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">{confirm.message}</p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setConfirm(null)}
                className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl transition text-xs"
              >
                Cancelar
              </button>
              <button
                id="billing-confirm-btn"
                onClick={() => {
                  const fn = confirm.onConfirm;
                  setConfirm(null);
                  fn();
                }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl transition font-semibold text-xs"
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateModal && canManage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>Emitir Nueva Factura / Cargo</span>
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <form onSubmit={handleCreateInvoiceSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Seleccionar Cliente Receptor</label>
                <select
                  required
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 focus:outline-none"
                >
                  <option value="">-- Elige un suscriptor --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.connectionType || 'WISP'}) - Estatus: {c.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Concepto de Cobro</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Suscripción Mensual Plan 50 Megas Fibra"
                  value={formConcept}
                  onChange={(e) => setFormConcept(e.target.value)}
                  className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Costo Neto (MXN)</label>
                  <input
                    type="number"
                    required
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Fecha de Vencimiento</label>
                  <input
                    type="date"
                    required
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!!busyLabel}
                  className="bg-indigo-600 hover:bg-indigo-400 disabled:bg-slate-800 text-white px-5 py-2 rounded-xl transition font-semibold"
                >
                  Emitir Factura
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      {showEditModal && canManage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Edit className="w-4 h-4 text-indigo-400" />
                <span>Editar Factura / Cargo</span>
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-white font-bold">✕</button>
            </div>

            <form onSubmit={handleEditInvoiceSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Concepto de Cobro</label>
                <input
                  type="text"
                  required
                  value={editConcept}
                  onChange={(e) => setEditConcept(e.target.value)}
                  className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Costo Neto (MXN)</label>
                  <input
                    type="number"
                    required
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Fecha de Vencimiento</label>
                  <input
                    type="date"
                    required
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 font-mono"
                  />
                </div>
              </div>

              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!!busyLabel}
                  className="bg-indigo-600 hover:bg-indigo-400 disabled:bg-slate-800 text-white px-5 py-2 rounded-xl transition font-semibold"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
      )}
    </div>
  );
}
