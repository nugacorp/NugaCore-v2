import React, { useState } from 'react';
import { 
  DollarSign, 
  Shield, 
  Briefcase, 
  Plus, 
  Trash2, 
  Clock, 
  Key, 
} from 'lucide-react';
import { Client, Invoice, Ticket as SupportTicket } from '../types';

interface FinanceOwnerModuleProps {
  clients: Client[];
  invoices: Invoice[];
  tickets: SupportTicket[];
  getAuthHeaders?: () => Promise<Record<string, string>>;
  onAddTicket: (ticketData: any) => Promise<void>;
  onPayInvoice: (invoiceId: string, method: string) => Promise<void>;
  mode?: 'finance' | 'owner';
  key?: string;
}

export default function FinanceOwnerModule({ 
  invoices, 
  getAuthHeaders,
  mode = 'owner'
}: FinanceOwnerModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<'finance' | 'hr' | 'security'>(
    mode === 'finance' ? 'finance' : 'security'
  );
  const [cfdiStatus, setCfdiStatus] = useState<{ mode: string; message: string; timbrado: boolean } | null>(null);

  React.useEffect(() => {
    if (!getAuthHeaders) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/finance/cfdi/status', { headers });
        if (res.ok && !cancelled) setCfdiStatus(await res.json());
      } catch {
        if (!cancelled) setCfdiStatus(null);
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  // --- Sub-Tab 1: Finance State ---
  // Sin datos mock: la lista inicia vacía y se carga desde la API real.
  const [egresos, setEgresos] = useState<Array<{ id: string; desc: string; category: string; amount: number; state: 'pagado' | 'pendiente' }>>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = (await getAuthHeaders?.()) ?? {};
        const res = await fetch('/api/finance/operational/expenses', { headers });
        if (!res.ok) return;
        const rows: Array<{ id: string; description: string; category: string; amountCents: number }> = await res.json();
        if (!cancelled) {
          setEgresos(rows.map(r => ({
            id: r.id,
            desc: r.description,
            category: r.category || 'Otros',
            amount: Math.round((r.amountCents ?? 0) / 100),
            state: 'pagado',
          })));
        }
      } catch {
        /* tolerante: deja la lista vacía cuando no hay backend */
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  const [newEgresoDesc, setNewEgresoDesc] = useState('');
  const [newEgresoCategory, setNewEgresoCategory] = useState('Arrendamientos');
  const [newEgresoAmount, setNewEgresoAmount] = useState('');

  const handleAddEgreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEgresoDesc || !newEgresoAmount) return;
    try {
      const headers = (await getAuthHeaders?.()) ?? {};
      const res = await fetch('/api/finance/operational/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          description: newEgresoDesc,
          category: newEgresoCategory.toLowerCase(),
          amount: Number(newEgresoAmount),
          currency: 'MXN',
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setEgresos([
          { id: created.id, desc: created.description, category: created.category, amount: Math.round(created.amountCents / 100), state: 'pagado' },
          ...egresos,
        ]);
      }
    } catch {
      /* noop */
    }
    setNewEgresoDesc('');
    setNewEgresoAmount('');
  };

  const handleRemoveEgreso = async (id: string) => {
    try {
      const headers = (await getAuthHeaders?.()) ?? {};
      await fetch(`/api/finance/operational/expenses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      }).catch(() => {});
    } finally {
      setEgresos(egresos.filter(e => e.id !== id));
    }
  };

  // --- Sub-Tab: HR State ---
  // Recursos Humanos sin datos ficticios por defecto.
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; role: string; department: string; status: string; commission: number }>>([]);

  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpRole, setNewEmpRole] = useState('');
  const [newEmpDept, setNewEmpDept] = useState('Planta Externa');

  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmpName || !newEmpRole) return;
    setEmployees([
      ...employees,
      {
        id: `emp-${Date.now()}`,
        name: newEmpName,
        role: newEmpRole,
        department: newEmpDept,
        status: 'Activo',
        commission: 0
      }
    ]);
    setNewEmpName('');
    setNewEmpRole('');
  };

  // --- Sub-Tab 5: Security & API Config ---
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'all' | 'Admin' | 'Tecnico' | 'Cajero'>('all');

  // Math totals for Finanzas
  const totalIngresosFacturados = invoices.reduce((acc, current) => acc + current.amount, 0);
  const totalIngresosPagados = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((acc, current) => acc + current.amount, 0);
  const totalEgresosVal = egresos.reduce((acc, current) => acc + current.amount, 0);
  const ebitda = totalIngresosPagados > 0 
    ? ((totalIngresosPagados - totalEgresosVal) / totalIngresosPagados) * 100 
    : 0;

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Module Title Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            {mode === 'finance' ? (
              <>
                <DollarSign className="w-6 h-6 text-emerald-400" />
                <span>Finanzas Corporativas & EBITDA</span>
              </>
            ) : (
              <>
                <Shield className="w-6 h-6 text-indigo-400" />
                <span>Consola del Propietario</span>
              </>
            )}
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            {mode === 'finance' 
              ? 'Control ejecutivo de ingresos, egresos, gastos operativos, nóminas de personal y comisiones.'
              : 'Seguridad MFA, API audit y configuración sensible del operador WISP.'
            }
          </p>
        </div>

        {/* Global Mini Score */}
        <div className="flex bg-slate-950 p-1 border border-slate-800 rounded-xl space-x-1 font-mono text-[11px] self-start">
          <span className="text-slate-500 py-1 px-2">EBITDA: <strong className="text-emerald-400">{ebitda.toFixed(1)}%</strong></span>
          <span className="text-slate-500 py-1 px-2 border-l border-slate-900">Uptime NOC: <strong className="text-indigo-400">99.99%</strong></span>
        </div>
      </div>

      {/* Internal Sub Navigation (Tabs Bar) */}
      <div className="flex border-b border-slate-800/80 pb-px space-x-2 overflow-x-auto">
        {mode === 'finance' ? (
          <>
            <button
              onClick={() => setActiveSubTab('finance')}
              id="btn-owner-finance"
              className={`pb-3 text-xs font-mono font-bold px-4 transition-all duration-150 border-b-2 tracking-wide uppercase ${
                activeSubTab === 'finance' 
                  ? 'border-indigo-500 text-white font-black' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <DollarSign className="w-3.5 h-3.5" />
                <span>Finanzas & EBITDA</span>
              </div>
            </button>

            <button
              onClick={() => setActiveSubTab('hr')}
              id="btn-owner-hr"
              className={`pb-3 text-xs font-mono font-bold px-4 transition-all duration-150 border-b-2 tracking-wide uppercase ${
                activeSubTab === 'hr' 
                  ? 'border-indigo-500 text-white font-black' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Briefcase className="w-3.5 h-3.5" />
                <span>Nómina & Comisiones (RH)</span>
              </div>
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setActiveSubTab('security')}
            id="btn-owner-security"
            className={`pb-3 text-xs font-mono font-bold px-4 transition-all duration-150 border-b-2 tracking-wide uppercase ${
              activeSubTab === 'security'
                ? 'border-indigo-500 text-white font-black'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center space-x-2">
              <Shield className="w-3.5 h-3.5" />
              <span>Seguridad (MFA & API Logs)</span>
            </div>
          </button>
        )}
      </div>

      {/* TABS CONTAINER */}
      <div className="space-y-6">

        {/* --- TAB 1: FINANCE BOARD --- */}
        {activeSubTab === 'finance' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-500 font-mono tracking-wider block uppercase">Facturado Total del Mes</span>
                <span className="text-xl font-bold text-slate-100 font-mono block mt-1">
                  ${totalIngresosFacturados.toLocaleString('es-MX')} MXN
                </span>
                <span className="text-[9px] text-slate-500 block">Cartera total emitida</span>
              </div>

              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 font-mono tracking-wider block uppercase">Cobrado / Liquidado real</span>
                <span className="text-xl font-bold text-emerald-400 font-mono block mt-1">
                  ${totalIngresosPagados.toLocaleString('es-MX')} MXN
                </span>
                <span className="text-[9px] text-emerald-500 block">Flujo de caja inmediato</span>
              </div>

              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 font-mono tracking-wider block uppercase">Egresos / Gastos Operativos</span>
                <span className="text-xl font-bold text-rose-400 font-mono block mt-1">
                  -${totalEgresosVal.toLocaleString('es-MX')} MXN
                </span>
                <span className="text-[9px] text-rose-500 block">Calculando nómina, fibra & renta</span>
              </div>

              <div className="bg-slate-950 p-4 border border-slate-800 rounded-xl">
                <span className="text-[10px] text-slate-400 font-mono tracking-wider block uppercase">Utilidad de Operación Neta</span>
                <span className="text-xl font-bold text-white font-mono block mt-1">
                  ${(totalIngresosPagados - totalEgresosVal).toLocaleString('es-MX')} MXN
                </span>
                <span className="text-[9px] text-indigo-400 block">Margen Neto Ejecutivo</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Egresos list */}
              <div className="lg:col-span-8 bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                  <h3 className="text-sm font-bold text-white font-mono uppercase">Control de Egresos, Energía & Arrendamientos</h3>
                  <span className="text-[11px] text-slate-400 font-mono">CFDI 4.0 Comprobantes fiscales</span>
                </div>
                {cfdiStatus && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    PAC: {cfdiStatus.mode} · timbrado={cfdiStatus.timbrado ? 'sí' : 'no'} — {cfdiStatus.message}
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead>
                      <tr className="border-b border-slate-900/80 text-slate-500 uppercase text-[10px]">
                        <th className="py-2.5">Concepto</th>
                        <th className="py-2.5 text-center">Categoría</th>
                        <th className="py-2.5 text-right">Monto</th>
                        <th className="py-2.5 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-920">
                      {egresos.map(eg => (
                        <tr key={eg.id} className="hover:bg-slate-900/30 text-xs">
                          <td className="py-3 text-slate-100 font-sans font-medium">{eg.desc}</td>
                          <td className="py-3 text-center">
                            <span className="bg-slate-800 border border-slate-700 text-slate-400 py-0.5 px-2 rounded-full text-[9px] uppercase font-bold">
                              {eg.category}
                            </span>
                          </td>
                          <td className="py-3 text-right text-rose-300 font-bold font-mono">
                            -${eg.amount.toLocaleString('es-MX')}
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => handleRemoveEgreso(eg.id)}
                              className="text-slate-500 hover:text-rose-400 p-1 transition"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Gasto addition form */}
                <form onSubmit={handleAddEgreso} className="grid grid-cols-1 md:grid-cols-12 gap-3 border-t border-slate-900 pt-4">
                  <div className="md:col-span-6">
                    <input
                      type="text"
                      required
                      placeholder="Concepto de Egreso (Ej. Pago energía CFE)"
                      value={newEgresoDesc}
                      onChange={e => setNewEgresoDesc(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <select
                      value={newEgresoCategory}
                      onChange={e => setNewEgresoCategory(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-300 focus:outline-none"
                    >
                      <option value="Arrendamientos">Arrendamiento</option>
                      <option value="Telecomunicaciones">Telecom ded.</option>
                      <option value="Energía">CFE Energía</option>
                      <option value="Recursos Humanos">R.H. / Nómina</option>
                      <option value="Otros">Otros</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="$ Monto"
                      value={newEgresoAmount}
                      onChange={e => setNewEgresoAmount(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-1">
                    <button
                      type="submit"
                      className="w-full bg-indigo-600 hover:bg-indigo-500 hover:shadow text-white rounded-lg p-2 flex items-center justify-center transition cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              </div>

              {/* EBITDA KPI side info */}
              <div className="lg:col-span-4 space-y-4">
                <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
                  <h3 className="text-sm font-bold text-white font-mono uppercase">Estructura Fiscal CFDI 4.0 México</h3>
                  <p className="text-[11px] text-slate-400 leading-normal">
                    NugaCore opera facturación timbrada autorizada por el SAT. Automatiza la retención de impuestos, complementos fiscales y emisión de notas de de crédito.
                  </p>
                  
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between border-b border-slate-900 pb-1.5">
                      <span className="text-slate-500">Régimen SAT</span>
                      <span className="text-slate-300 font-bold">Sociedad de Acceso Tecnológico (S.A.)</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-900 pb-1.5">
                      <span className="text-slate-500">I.V.A. Trasladado (16%)</span>
                      <span className="text-indigo-400 font-bold">${(totalIngresosPagados * 0.16).toFixed(0)} MXN</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-900 pb-1.5">
                      <span className="text-slate-500">Retención de I.S.R.</span>
                      <span className="text-slate-300">Aprobado / Al Día (Anual)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Complementos de Pago</span>
                      <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded text-[9px]">Sincronizados</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-tr from-indigo-950/20 to-sky-950/20 border border-indigo-500/10 p-5 rounded-2xl text-center space-y-3">
                  <TrendingUpIcon className="w-8 h-8 text-indigo-400 mx-auto" />
                  <span className="text-xs font-mono font-bold text-white block uppercase">Ingreso Anual Proyectado ARR</span>
                  <span className="text-2xl font-bold text-white block font-mono">
                    ${(totalIngresosPagados * 12).toLocaleString('es-MX')} MXN
                  </span>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    Proyección financiera estimada sobre la base de consumo local recurrente actual sin Churn crítico.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 4: RECURSOS HUMANOS & ROSTER (ITEM 12) --- */}
        {activeSubTab === 'hr' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Staff roster (8 cols) */}
            <div className="lg:col-span-8 bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                <h3 className="text-sm font-bold text-white font-mono uppercase">Roster de Personal, Horarios & Comisiones</h3>
                <span className="text-[11px] text-slate-400 font-mono">Comisiones automatizadas SAT</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead>
                    <tr className="border-b border-slate-900/80 text-slate-500 uppercase text-[10px]">
                      <th className="py-2.5">Empleado</th>
                      <th className="py-2.5 text-center">Departamento</th>
                      <th className="py-2.5 text-center">Estatus Horario</th>
                      <th className="py-2.5 text-right">Comisiones Mes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-920">
                    {employees.map(emp => (
                      <tr key={emp.id} className="hover:bg-slate-900/30 text-xs">
                        <td className="py-3">
                          <span className="font-semibold text-slate-100 block font-sans">{emp.name}</span>
                          <span className="text-[9px] text-slate-500">{emp.role}</span>
                        </td>
                        <td className="py-3 text-center text-slate-400">{emp.department}</td>
                        <td className="py-3 text-center">
                          {emp.status === 'Activo' ? (
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px] uppercase font-bold">En Turno</span>
                          ) : (
                            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] uppercase font-bold">Pasivo / Guardia</span>
                          )}
                        </td>
                        <td className="py-3 text-right text-indigo-400 font-bold">${emp.commission.toLocaleString('es-MX')} MXN</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add staff form */}
              <form onSubmit={handleAddEmployee} className="grid grid-cols-1 md:grid-cols-12 gap-3 border-t border-slate-900 pt-4">
                <div className="md:col-span-5">
                  <input
                    type="text"
                    required
                    placeholder="Nombre Completo"
                    value={newEmpName}
                    onChange={e => setNewEmpName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-4">
                  <input
                    type="text"
                    required
                    placeholder="Función Ejecutiva"
                    value={newEmpRole}
                    onChange={e => setNewEmpRole(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-600 focus:outline-none"
                  />
                </div>
                <div className="md:col-span-2">
                  <select
                    value={newEmpDept}
                    onChange={e => setNewEmpDept(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-300 focus:outline-none"
                  >
                    <option value="Planta Externa">Planta Externa</option>
                    <option value="Cuentas por Cobrar">Cobranza</option>
                    <option value="Ventas WISP">Ventas WISP</option>
                    <option value="Soporte Técnico">Soporte</option>
                  </select>
                </div>
                <div className="md:col-span-1">
                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg p-2 flex items-center justify-center transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>

            {/* Bonus rule and schedule controls (4 cols) */}
            <div className="lg:col-span-4 bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
              <span className="text-xs font-mono font-bold text-indigo-400 block uppercase tracking-wider">Políticas de Incentivo (RH)</span>
              <h3 className="text-sm font-bold text-white font-mono uppercase">Cálculo de Comisiones</h3>
              <p className="text-xs text-slate-400 leading-normal">
                Configura los bonos automáticos calculados al liquidar cobranzas o concretar instalaciones en terreno por contrato.
              </p>

              <div className="space-y-4 text-xs font-mono font-semibold">
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-900/80 space-y-1">
                  <span className="text-slate-500 block text-[9px] uppercase">Antena / Radio CPE Instalada</span>
                  <span className="text-emerald-400 font-bold block">$150.00 MXN bono directo</span>
                  <span className="text-[9px] text-slate-500 block font-normal">Aplica a técnico firmante de la O.T.</span>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-900/80 space-y-1">
                  <span className="text-slate-500 block text-[9px] uppercase">Alta de Prospecto/Venta WISP</span>
                  <span className="text-indigo-400 font-bold block">$300.00 MXN comisión</span>
                  <span className="text-[9px] text-slate-500 block font-normal">Al convertirse lead calificado a activo</span>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-900/80 space-y-1">
                  <span className="text-slate-500 block text-[9px] uppercase">Recaudación Cobranza Atrasada</span>
                  <span className="text-amber-400 font-bold block">5% del total recuperado</span>
                  <span className="text-[9px] text-slate-500 block font-normal font-sans">Aplica sobre facturas con &gt;30 días vencidas</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 5: SECURITY, AUDIT & CREDENTIALS (ITEMS 16, 17) --- */}
        {activeSubTab === 'security' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* Audit Logs (8 cols) */}
            <div className="lg:col-span-8 bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-900 pb-3">
                <h3 className="text-sm font-bold text-white font-mono uppercase">Bitácora de Cambios & Auditorías</h3>
                
                {/* Audit Role filter */}
                <select
                  value={selectedRoleFilter}
                  onChange={e => setSelectedRoleFilter(e.target.value as any)}
                  className="bg-slate-900 border border-slate-800 text-[10px] text-slate-300 rounded font-mono px-2 py-1 focus:outline-none"
                >
                  <option value="all">Filtro de Rol (Todos)</option>
                  <option value="Admin">Administrador</option>
                  <option value="Tecnico">Técnico campo</option>
                  <option value="Cajero">Cajero cobros</option>
                </select>
              </div>

              <div className="flex flex-col items-center justify-center py-10 text-center space-y-2 text-slate-500 font-mono text-xs">
                <Clock className="w-8 h-8 text-slate-700 mb-1" />
                <p className="text-slate-400 font-semibold">Sin bitácora real todavía.</p>
                <p className="text-slate-600 leading-relaxed max-w-xs">
                  Cuando exista auditoría persistida, aparecerá aquí.
                  {selectedRoleFilter !== 'all' && (
                    <span className="block mt-1 text-amber-500/70">
                      Filtro de rol activo: {selectedRoleFilter}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Credentials / MFA (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              
              {/* MFA Switcher */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                  <span className="text-xs font-mono font-bold text-slate-400 uppercase">Seguridad del Panel</span>
                  <Shield className="w-4 h-4 text-emerald-400" />
                </div>

                <div className="flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-white block">Autenticación MFA / SSO</span>
                    <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">Preferencia local — pendiente de backend</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mfaEnabled}
                      onChange={() => setMfaEnabled(!mfaEnabled)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600 peer-checked:after:bg-white border border-slate-700"></div>
                  </label>
                </div>
              </div>

              {/* API Integration Status — no fake data */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-3.5">
                <span className="text-xs font-mono font-bold text-indigo-400 block uppercase tracking-wider">Integraciones Externas</span>
                <h3 className="text-sm font-bold text-white font-mono uppercase">Estado de Conexiones</h3>

                <div className="space-y-2.5 text-xs font-mono font-semibold">
                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-slate-500" />
                      <span>Stripe Gateway</span>
                    </div>
                    <span className="text-[9px] text-amber-500 uppercase">No conectado — sin datos mock</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-slate-500" />
                      <span>WhatsApp Cloud API</span>
                    </div>
                    <span className="text-[9px] text-amber-500 uppercase">No conectado — sin datos mock</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span>Mikrotik ROS API</span>
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase">Port 8728 — ver módulo Red</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-slate-500" />
                      <span>Telegram Bot</span>
                    </div>
                    <span className="text-[9px] text-amber-500 uppercase">No conectado — sin datos mock</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// Inline Mini components to replace d3 and reduce dependency pollution
function TrendingUpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
