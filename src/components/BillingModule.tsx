import React, { useState } from 'react';
import { 
  CreditCard, 
  Search, 
  TrendingUp, 
  Briefcase, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  ExternalLink,
  ChevronRight,
  Zap,
  Check
} from 'lucide-react';
import { Invoice } from '../types';

interface BillingModuleProps {
  invoices: Invoice[];
  onPayInvoice: (id: string, method: string) => Promise<void>;
}

export default function BillingModule({ invoices, onPayInvoice }: BillingModuleProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [payGateway, setPayGateway] = useState('Stripe');
  const [paymentInProgress, setPaymentInProgress] = useState(false);

  const formatMXN = (num: number) => {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
  };

  const filteredInvoices = invoices.filter(inv => {
    const matchesSearch = inv.clientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          inv.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || inv.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handlePaySubmit = async (invId: string) => {
    setPaymentInProgress(true);
    try {
      await onPayInvoice(invId, payGateway);
      setSelectedInvoice(null);
    } catch (err) {
      console.error(err);
    } finally {
      setPaymentInProgress(false);
    }
  };

  const overdueCount = invoices.filter(i => i.status === 'overdue').length;
  const totalInvoiced = invoices.reduce((acc, i) => acc + i.amount, 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((acc, i) => acc + i.amount, 0);
  const totalPending = invoices.filter(i => i.status === 'unpaid' || i.status === 'overdue').reduce((acc, i) => acc + i.amount, 0);

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Header Bento and KPI blocks */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Facturación Fiscal & Cobros</h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Módulo ERP completo de timbrado SAT CFDI 4.0 México, pasarelas de pago y recordatorios automáticos de cobranza.
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-lg font-mono">
            SAT API: ONLINE (CFDI 4.0 CONEXION DIRECTA)
          </span>
        </div>
      </div>

      {/* Stats row with a Bento design, mimicking the green highlight card */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
        {/* Dynamic bright emerald card (from design request) */}
        <div className="md:col-span-4 bg-emerald-500 rounded-3xl p-6 text-slate-950 flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-80">Por Cobrar en Mayo</h3>
            <p className="text-4xl font-extrabold mt-3 tracking-tight">{formatMXN(totalPending)}</p>
            <div className="bg-slate-950/20 p-4 rounded-xl mt-3 text-xs border border-white/10">
              <div className="flex justify-between items-center font-bold">
                <span>SAT CFDI 4.0</span>
                <span className="bg-slate-950 text-white px-2 py-0.5 rounded text-[8px]">ACTIVE</span>
              </div>
              <p className="mt-1 opacity-90">Timbrado automático del 100% de la facturación recurrente.</p>
            </div>
          </div>
          <button 
            onClick={() => alert("Generando reporte PDF consolidado para NugaCorp...")}
            className="mt-6 w-full bg-slate-950 hover:bg-slate-900 text-white py-3 rounded-2xl text-xs font-bold transition font-mono uppercase tracking-widest text-center block"
          >
            Generar Reporte Cobranza
          </button>
        </div>

        {/* Breakdown Bento Box */}
        <div className="md:col-span-8 bg-slate-950 p-6 rounded-3xl border border-slate-800 flex flex-col justify-between">
          <div className="space-y-4">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-mono font-bold">Resumen de Cuenta de Facturas</p>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900">
                <span className="text-[10px] text-slate-500 block uppercase font-mono">Total Facturado</span>
                <span className="text-xl font-bold font-mono text-white">{formatMXN(totalInvoiced)}</span>
                <span className="text-[9px] text-slate-500 block mt-1">Con IVA incluido (16%)</span>
              </div>
              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900">
                <span className="text-[10px] text-slate-400 block uppercase font-mono">Clientes Pagados</span>
                <span className="text-xl font-bold font-mono text-emerald-400">{formatMXN(totalPaid)}</span>
                <span className="text-[9px] text-emerald-500/80 block mt-1">Conciliación automática OK</span>
              </div>
              <div className="bg-slate-900/60 p-4 rounded-2xl border border-slate-900">
                <span className="text-[10px] text-slate-400 block uppercase font-mono">Vencimientos</span>
                <span className="text-xl font-bold font-mono text-rose-400">{overdueCount} Recargos</span>
                <span className="text-[9px] text-rose-400/80 block mt-1">Sujetos a suspensión</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/40 p-4 rounded-2xl border border-slate-900 text-xs text-slate-400 leading-relaxed mt-4 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <span>NugaCore detectará de inmediato los pagos SPEI / Stripe y enviará llamadas de reactivación en el Router Core RouterOS.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main ledger list & Invoice details */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Invoice list (7 columns) */}
        <div className="lg:col-span-7 bg-slate-950 p-5 rounded-3xl border border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between border-b border-slate-900 pb-4 mb-4">
            <p className="text-sm font-bold text-white tracking-wide">Registro de Facturas Emitidas</p>
            <div className="flex gap-2">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-xl px-2.5 py-1.5 focus:outline-none"
              >
                <option value="all">Ver todas</option>
                <option value="paid">Pagadas</option>
                <option value="unpaid">Sin Pagar</option>
                <option value="overdue">Vencidas</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
            {filteredInvoices.map((inv) => (
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
                    Fecha límite de pago: <span className="text-slate-300">{inv.dueDateStr}</span>
                    {inv.cfdiUuid && (
                      <span className="text-slate-500 block text-[9px] mt-0.5 truncate max-w-[200px]">SAT UUID: {inv.cfdiUuid}</span>
                    )}
                  </div>
                </div>

                <div className="text-right space-y-1.5">
                  <span className="font-bold font-mono text-sm text-white block">{formatMXN(inv.amount)}</span>
                  <div>
                    {inv.status === 'paid' && (
                      <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase inline-block">
                        Pagada
                      </span>
                    )}
                    {inv.status === 'unpaid' && (
                      <span className="bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase inline-block animate-pulse">
                        Socio Pendiente
                      </span>
                    )}
                    {inv.status === 'overdue' && (
                      <span className="bg-rose-500/15 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase inline-block animate-pulse">
                        Vencida / Corte
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Invoice Detail inspection & Pay wizard (5 columns) */}
        <div className="lg:col-span-5">
          {selectedInvoice ? (
            <div id="billing-detail-wizard" className="bg-slate-950 p-6 rounded-3xl border border-slate-800 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <div>
                  <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono tracking-widest uppercase px-2 py-0.5 rounded">
                    Revisión de Folio
                  </span>
                  <h4 className="text-base font-bold text-white mt-1.5">Detalles de Facturación</h4>
                </div>
                <button onClick={() => setSelectedInvoice(null)} className="text-slate-500 hover:text-white font-bold">✕</button>
              </div>

              {/* Items Table */}
              <div className="space-y-4 text-xs font-mono">
                <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-900">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold">Cliente Receptor</span>
                  <span className="text-sm font-semibold text-white block mt-0.5">{selectedInvoice.clientName}</span>
                  <span className="text-[9px] text-slate-500 block mt-1">Suscrito a Nuga Core WISP</span>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold mb-2">Desglose de Conceptos</span>
                  {selectedInvoice.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between text-slate-300 py-1 border-b border-slate-900">
                      <span className="truncate max-w-[200px]">{it.description}</span>
                      <span className="font-semibold text-slate-100">{formatMXN(it.price * it.qty)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 text-sm font-bold text-white mt-2">
                    <span>Total Neto</span>
                    <span className="font-semibold text-emerald-400">{formatMXN(selectedInvoice.amount)}</span>
                  </div>
                </div>

                {/* Payments done log */}
                <div>
                  <span className="text-[10px] text-slate-500 uppercase block font-semibold mb-2">Historial de Transacción</span>
                  {selectedInvoice.payments.length > 0 ? (
                    selectedInvoice.payments.map((p, idx) => (
                      <div key={idx} className="bg-slate-900/40 p-3 rounded-xl border border-slate-900/50 space-y-1">
                        <div className="flex justify-between items-center text-slate-200">
                          <span className="font-bold">{p.method} Gateway</span>
                          <span className="text-emerald-400 text-[11px] font-bold">Pagado</span>
                        </div>
                        <div className="text-[10px] text-slate-500 flex justify-between">
                          <span>{p.date}</span>
                          <span className="text-indigo-400 underline truncate max-w-[150px]">{p.transactionId}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-[11px] italic">Esta factura todavía no ha recibido transacciones de pago.</p>
                  )}
                </div>

                {/* Gateway trigger */}
                {selectedInvoice.status !== 'paid' && (
                  <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800/80 space-y-3">
                    <span className="text-slate-400 font-bold uppercase text-[9px] font-mono block">Simulación de Pasarela de Pago</span>
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
                      onClick={() => handlePaySubmit(selectedInvoice.id)}
                      disabled={paymentInProgress}
                      className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 text-slate-950 font-bold font-mono text-xs flex items-center justify-center space-x-1.5 transition uppercase tracking-widest shadow-lg shadow-emerald-500/15"
                    >
                      {paymentInProgress ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-white rounded-full animate-spin"></span>
                          <span>Procesando...</span>
                        </>
                      ) : (
                        <span>Simular Conciliación {payGateway}</span>
                      )}
                    </button>
                    <p className="text-[9px] text-slate-500 leading-normal text-center">
                      Al simular la conciliación, se timbrará el CFDI 4.0 con sello digital y se disparará la reactivación automática en MikroTik.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-950 p-6 rounded-3xl border border-slate-800 text-center py-12 text-slate-500 font-mono">
              <FileText className="w-12 h-12 text-slate-850 mx-auto mb-3" />
              <p className="text-sm">Inspecciona los conceptos de cualquier emisión para timbrar o simular pagos en línea.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
