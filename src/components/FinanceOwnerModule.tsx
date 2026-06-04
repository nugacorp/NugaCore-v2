import React, { useState } from 'react';
import { 
  DollarSign, 
  Users, 
  Zap, 
  Shield, 
  Smartphone, 
  Briefcase, 
  Plus, 
  Trash2, 
  Play, 
  Clock, 
  Cpu, 
  Key, 
  CheckCircle,
  AlertCircle,
  FileText,
  CreditCard,
  Send,
  Wifi,
  Ticket
} from 'lucide-react';
import { Client, Invoice, Ticket as SupportTicket } from '../types';

interface FinanceOwnerModuleProps {
  clients: Client[];
  invoices: Invoice[];
  tickets: SupportTicket[];
  onAddTicket: (ticketData: any) => Promise<void>;
  onPayInvoice: (invoiceId: string, method: string) => Promise<void>;
  mode?: 'finance' | 'owner';
  key?: string;
}

export default function FinanceOwnerModule({ 
  clients, 
  invoices, 
  tickets,
  onAddTicket,
  onPayInvoice,
  mode = 'owner'
}: FinanceOwnerModuleProps) {
  const [activeSubTab, setActiveSubTab] = useState<'finance' | 'portal' | 'automations' | 'hr' | 'security'>(
    mode === 'finance' ? 'finance' : 'automations'
  );

  // --- Sub-Tab 1: Finance State ---
  const [egresos, setEgresos] = useState([
    { id: 'egr-1', desc: 'Arrendamiento de Torre Alfa (Espacio)', category: 'Arrendamientos', amount: 8500, state: 'pagado' },
    { id: 'egr-2', desc: 'Enlace Dedicado Carrier WAN Giga (Backbone)', category: 'Telecomunicaciones', amount: 35000, state: 'pagado' },
    { id: 'egr-3', desc: 'Costo Eléctrico Co-Location Torres & Nodos', category: 'Energía', amount: 4200, state: 'pagado' },
    { id: 'egr-4', desc: 'Nómina Administrativa y Campo', category: 'Recursos Humanos', amount: 48000, state: 'pagado' },
    { id: 'egr-5', desc: 'Licencias IPs Homologadas LACNIC', category: 'Otros', amount: 3000, state: 'pendiente' },
  ]);

  const [newEgresoDesc, setNewEgresoDesc] = useState('');
  const [newEgresoCategory, setNewEgresoCategory] = useState('Arrendamientos');
  const [newEgresoAmount, setNewEgresoAmount] = useState('');

  const handleAddEgreso = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEgresoDesc || !newEgresoAmount) return;
    setEgresos([
      ...egresos,
      {
        id: `egr-${Date.now()}`,
        desc: newEgresoDesc,
        category: newEgresoCategory,
        amount: Number(newEgresoAmount),
        state: 'pagado'
      }
    ]);
    setNewEgresoDesc('');
    setNewEgresoAmount('');
  };

  const handleRemoveEgreso = (id: string) => {
    setEgresos(egresos.filter(e => e.id !== id));
  };

  // --- Sub-Tab 2: Portal del Cliente State ---
  const [selectedPortalClient, setSelectedPortalClient] = useState<Client | null>(clients[0] || null);
  const [portalTicketTitle, setPortalTicketTitle] = useState('');
  const [portalTicketDesc, setPortalTicketDesc] = useState('');
  const [portalPayingInvoice, setPortalPayingInvoice] = useState<Invoice | null>(null);
  const [portalPaymentSuccess, setPortalPaymentSuccess] = useState(false);
  const [payGateway, setPayGateway] = useState<'stripe' | 'mercadopago' | 'paypal' | 'spei'>('stripe');

  const clientInvoices = invoices.filter(inv => inv.clientId === selectedPortalClient?.id);
  const clientTickets = tickets.filter(t => t.clientId === selectedPortalClient?.id);

  const triggerClientTicketSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPortalClient || !portalTicketTitle) return;
    await onAddTicket({
      clientId: selectedPortalClient.id,
      title: `[Portal] ${portalTicketTitle}`,
      description: portalTicketDesc,
      category: 'Internet',
      severity: 'medium'
    });
    setPortalTicketTitle('');
    setPortalTicketDesc('');
    alert('¡Ticket enviado correctamente desde el Portal del Cliente!');
  };

  const [portalPayError, setPortalPayError] = useState('');
  const triggerPayFromPortal = async () => {
    if (!portalPayingInvoice) return;
    setPortalPayError('');
    try {
      await onPayInvoice(portalPayingInvoice.id, payGateway.toUpperCase());
      setPortalPaymentSuccess(true);
      setTimeout(() => {
        setPortalPaymentSuccess(false);
        setPortalPayingInvoice(null);
      }, 2000);
    } catch (err: any) {
      setPortalPayError(err?.message || 'No se pudo procesar el pago.');
    }
  };

  // --- Sub-Tab 3: Automations State ---
  const [automations, setAutomations] = useState([
    { id: 'auto-1', trigger: 'Factura Vence', action: 'Enviar mensaje de WhatsApp aviso previo', active: true, logs: 12 },
    { id: 'auto-2', trigger: 'Pago de Factura', action: 'Reactivación automática de PPP Secret Mikrotik', active: true, logs: 8 },
    { id: 'auto-3', trigger: 'Caja NAP llena', action: 'Enviar Alerta crítica al NOC', active: false, logs: 0 },
    { id: 'auto-4', trigger: 'Falla Ping Torre (>100ms)', action: 'Emitir ticket de soporte técnico nivel 1', active: true, logs: 4 },
  ]);

  const toggleAutomation = (id: string) => {
    setAutomations(automations.map(a => a.id === id ? { ...a, active: !a.active } : a));
  };

  const [testLog, setTestLog] = useState<string[]>([]);
  const executeSimulation = (triggerName: string) => {
    let message = '';
    if (triggerName === 'Pago de Factura') {
      message = `🚀 [WORKFLOW TRIGGERED]: Cliente pagó adeudo. ROS API ordenó habilitar interface PPPoE y recargar queues a 50Mbps.`;
    } else if (triggerName === 'Falla Ping Torre (>150ms)') {
      message = `⚠️ [WORKFLOW TRIGGERED]: Ping Torre Ajusco de 180ms. Creado Ticket de diagnóstico preventivo despachado de forma automática a Coche Técnico 1.`;
    } else {
      message = `⚙️ [WORKFLOW TRIGGERED]: Recordatorios masivos emitidos vía WhatsApp Gateway para 5 suscriptores pendientes.`;
    }
    setTestLog(prev => [new Date().toLocaleTimeString() + ' - ' + message, ...prev]);
  };

  // --- Sub-Tab 4: HR State ---
  const [employees, setEmployees] = useState([
    { id: 'emp-1', name: 'Ing. Carlos Ortiz Torres', role: 'Técnico de Red / Planta Exterior', department: 'Planta Externa', status: 'Activo', commission: 2450 },
    { id: 'emp-2', name: 'Lic. Miriam Valdez', role: 'Gestora Cobranza y Facturación', department: 'Cuentas por Cobrar', status: 'Activo', commission: 4100 },
    { id: 'emp-3', name: 'Juan Manuel Rubio', role: 'Vendedor y Prospección en Campo', department: 'Ventas WISP', status: 'Activo', commission: 5600 },
    { id: 'emp-4', name: 'Téc. Fernando Ruiz', role: 'Soporte y Mesa en Sitio CDMX', department: 'Soporte Técnico', status: 'Guardia', commission: 1200 },
  ]);

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
  const [auditLogs] = useState([
    { id: 'audit-1', user: 'rnrgool@gmail.com', role: 'Admin', action: 'Provisionó ONU GPON cliente Sofia', ip: '189.201.2.22', timestamp: '2026-05-31 04:30:15' },
    { id: 'audit-2', user: 'miriam.valdez@nuga.com', role: 'Cajero', action: 'Registró Pago Invoice fac-101 (SPEI)', ip: '189.201.2.45', timestamp: '2026-05-31 02:15:10' },
    { id: 'audit-3', user: 'carlos.ortiz@nuga.com', role: 'Tecnico', action: 'Actualizó estatus Orden de Trabajo #12 a "Completada"', ip: '172.56.12.89', timestamp: '2026-05-30 18:22:04' },
    { id: 'audit-4', user: 'rnrgool@gmail.com', role: 'Admin', action: 'Editó límites de velocidad en perfil de plan empresarial', ip: '189.201.2.22', timestamp: '2026-05-30 16:40:02' },
  ]);

  const filteredAuditLogs = auditLogs.filter(log => selectedRoleFilter === 'all' || log.role === selectedRoleFilter);

  // Math totals for Finanzas
  const totalIngresosFacturados = invoices.reduce((acc, current) => acc + current.amount, 0);
  const totalIngresosPagados = invoices
    .filter(inv => inv.status === 'paid')
    .reduce((acc, current) => acc + current.amount, 0);
  const totalEgresosVal = egresos.reduce((acc, current) => acc + current.amount, 0);
  const mrrTotalEstimado = clients
    .filter(c => c.status === 'active')
    .length * 450; // simple estimation placeholder
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
                <span>Consola del Propietario / Automatizaciones</span>
              </>
            )}
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            {mode === 'finance' 
              ? 'Control ejecutivo de ingresos, egresos, gastos operativos, nóminas de personal y comisiones.'
              : 'Gestión de flujos automáticos de red, simulador de portal de cliente, seguridad MFA y API audit.'
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
          <>
            <button
              onClick={() => setActiveSubTab('automations')}
              id="btn-owner-automations"
              className={`pb-3 text-xs font-mono font-bold px-4 transition-all duration-150 border-b-2 tracking-wide uppercase ${
                activeSubTab === 'automations' 
                  ? 'border-indigo-500 text-white font-black' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Zap className="w-3.5 h-3.5" />
                <span>Workflows de IA & Triggers</span>
              </div>
            </button>

            <button
              onClick={() => setActiveSubTab('portal')}
              id="btn-owner-portal"
              className={`pb-3 text-xs font-mono font-bold px-4 transition-all duration-150 border-b-2 tracking-wide uppercase ${
                activeSubTab === 'portal' 
                  ? 'border-indigo-500 text-white font-black' 
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Smartphone className="w-3.5 h-3.5" />
                <span>Simulador App Cliente</span>
              </div>
            </button>

            <button
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
          </>
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

        {/* --- TAB 2: APP CLIENTE SIMULATOR (ITEM 11) --- */}
        {activeSubTab === 'portal' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Left box: Select client view */}
            <div className="lg:col-span-4 bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
              <span className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-wider block">Previsualizador de Portal</span>
              <h3 className="text-sm font-bold text-white font-mono uppercase">Seleccionar Suscriptor de Prueba</h3>
              <p className="text-xs text-slate-400 leading-normal">
                Selecciona cualquier cliente para ver la interfaz exacta de su portal de usuario en dispositivos móviles o Web (módulo "App Cliente").
              </p>

              <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
                {clients.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedPortalClient(c)}
                    className={`w-full p-2.5 rounded-xl border text-left text-xs font-mono transition flex justify-between items-center ${
                      selectedPortalClient?.id === c.id
                        ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                        : 'bg-slate-900/60 border-slate-900/80 text-slate-400 hover:border-slate-800'
                    }`}
                  >
                    <div>
                      <span className="font-bold truncate select-none block max-w-[170px]">{c.name}</span>
                      <span className="text-[9px] text-slate-500 font-light select-none block mt-0.5">{c.connectionType} • IP: {c.ip}</span>
                    </div>
                    {c.status === 'suspended' ? (
                      <span className="bg-rose-500/15 text-rose-400 text-[8px] border border-rose-500/20 px-1 py-0.2 rounded font-bold uppercase shrink-0">Cortado</span>
                    ) : (
                      <span className="bg-emerald-500/15 text-emerald-400 text-[8px] border border-emerald-500/20 px-1 py-0.2 rounded font-bold uppercase shrink-0">Habilitado</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Phone mockup emulator */}
            <div className="lg:col-span-8 flex justify-center">
              {selectedPortalClient ? (
                <div className="max-w-md w-full bg-slate-950 border-[6px] border-slate-800 rounded-[35px] p-4 shadow-2xl relative">
                  
                  {/* Phone notch bar */}
                  <div className="w-24 h-4 bg-slate-800 rounded-full mx-auto mb-4 flex items-center justify-center p-0.5 shadow-inner">
                    <div className="w-1.5 h-1.5 bg-sky-900 rounded-full mr-2"></div>
                    <div className="w-6 h-1 bg-slate-700 rounded-full"></div>
                  </div>

                  {/* Portal UI Container inside Phone */}
                  <div className="bg-slate-900 border border-slate-800/80 rounded-[28px] p-4 text-slate-300 font-sans min-h-[500px] flex flex-col justify-between">
                    <div>
                      {/* Customer Header */}
                      <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-bold text-white font-mono text-xs">
                            {selectedPortalClient.name.charAt(0)}
                          </div>
                          <div>
                            <span className="text-xs font-bold text-white block leading-tight">{selectedPortalClient.name}</span>
                            <span className="text-[9px] text-slate-500 block font-mono">Portal de Suscriptor NugaCore</span>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase">{selectedPortalClient.connectionType}</span>
                        </div>
                      </div>

                      {/* Connection speed metric logs */}
                      <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2 mb-4">
                        <div className="flex justify-between items-center text-[10px] font-mono">
                          <span className="text-slate-500 uppercase font-bold tracking-wider">Consumo de Ancho de Banda</span>
                          <span className="text-indigo-400">12 Mibps Actual</span>
                        </div>
                        
                        {/* Custom visual real-time consumption graph (mini SVG curve) */}
                        <div className="h-10 w-full flex items-end">
                          <svg className="w-full h-8" viewBox="0 0 200 40">
                            <path
                              d="M 0,35 Q 25,10 50,30 T 100,15 T 150,5 T 200,28 L 200,40 L 0,40 Z"
                              fill="rgba(99, 102, 241, 0.1)"
                              stroke="#6366f1"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                            <circle cx="150" cy="5" r="3" fill="#34d399" />
                          </svg>
                        </div>
                        <div className="flex justify-between text-[8px] text-slate-600 font-mono">
                          <span>Vel. Bajada: 50 Mbps</span>
                          <span>Uptime Sesión: 1d 12h</span>
                        </div>
                      </div>

                      {/* Invoices segment on App */}
                      <div className="space-y-2 mb-4">
                        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest block font-bold">Mis Facturas de Servicio</span>
                        {clientInvoices.length === 0 ? (
                          <div className="text-center py-4 bg-slate-950 rounded-xl border border-slate-800/60 font-mono text-[10px] text-slate-500">
                             Sin facturas activas.
                          </div>
                        ) : (
                          clientInvoices.map(inv => (
                            <div key={inv.id} className="bg-slate-950 p-2.5 rounded-xl border border-slate-900 flex justify-between items-center text-xs font-mono">
                              <div>
                                <span className="font-semibold block text-slate-200">Factura {inv.id.substring(0, 8)}</span>
                                <span className="text-slate-600 text-[10px] block font-sans">Periodo: {inv.dateStr}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-sm font-bold block text-white">${inv.amount} MXN</span>
                                {inv.status === 'paid' ? (
                                  <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 rounded uppercase font-bold">Pagado</span>
                                ) : (
                                  <button
                                    onClick={() => setPortalPayingInvoice(inv)}
                                    className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2 py-0.5 rounded uppercase font-mono shadow"
                                  >
                                    Pagar Ahora
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Quick Portal Ticket section */}
                      <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80">
                        <span className="text-[10px] font-mono text-slate-400 uppercase block font-bold mb-2">Reportar una Falla / Soporte</span>
                        
                        <form onSubmit={triggerClientTicketSubmit} className="space-y-2 font-mono text-xs">
                          <input
                            type="text"
                            required
                            placeholder="Asunto (Ej: No tengo Internet, luces rojas)"
                            value={portalTicketTitle}
                            onChange={e => setPortalTicketTitle(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white placeholder-slate-600 text-[11px] focus:outline-none"
                          />
                          <textarea
                            placeholder="Comentarios adicionales o detalle..."
                            value={portalTicketDesc}
                            onChange={e => setPortalTicketDesc(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white placeholder-slate-600 text-[11px] h-11 focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg py-1.5 transition text-[10px] font-bold uppercase flex items-center justify-center space-x-1"
                          >
                            <Ticket className="w-3.5 h-3.5" />
                            <span>Abrir Ticket Técnico</span>
                          </button>
                        </form>
                      </div>

                    </div>

                    <div className="text-center font-mono text-[9px] text-slate-600 border-t border-slate-800 mt-4 pt-2">
                      Soporte Técnico NugaCorp: CDMX & Guerrero | WISP API Connect
                    </div>
                  </div>

                  {/* Payment Gateway Modal Frame (Embedded in Simulator) */}
                  {portalPayingInvoice && (
                    <div className="absolute inset-0 bg-black/85 backdrop-blur-xs rounded-[35px] z-20 flex items-center justify-center p-6 text-xs text-slate-300 font-mono">
                      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 w-full space-y-4">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-900">
                          <span className="font-bold text-white flex items-center space-x-1">
                            <CreditCard className="w-4 h-4 text-indigo-400" />
                            <span>Pagar Factura {portalPayingInvoice.id.substring(0,6)}</span>
                          </span>
                          <button onClick={() => setPortalPayingInvoice(null)} className="text-slate-400 font-bold hover:text-white">✕</button>
                        </div>

                        {portalPaymentSuccess ? (
                          <div className="text-center py-6 text-emerald-400 space-y-2">
                            <CheckCircle className="w-10 h-10 mx-auto animate-bounce text-emerald-400" />
                            <span className="font-bold block">¡PAGO PROCESADO EXITOSAMENTE!</span>
                            <span className="text-[10px] block text-slate-500">Notificando APIs del MikroTik para restauración automática...</span>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div>
                              <span className="text-slate-500 block text-[9px] uppercase">Monto a Liquidar</span>
                              <span className="text-lg font-bold text-white block font-mono">${portalPayingInvoice.amount} MXN</span>
                            </div>

                            <div className="space-y-1.5">
                              <span className="text-slate-500 block text-[9px] uppercase">Pasarela de Pago</span>
                              <div className="grid grid-cols-2 gap-2 text-[10px]">
                                {[
                                  { id: 'stripe', name: 'Stripe Credit' },
                                  { id: 'mercadopago', name: 'Mercado Pago' },
                                  { id: 'paypal', name: 'PayPal' },
                                  { id: 'spei', name: 'SPEI / Transf.' }
                                ].map(gate => (
                                  <button
                                    key={gate.id}
                                    onClick={() => setPayGateway(gate.id as any)}
                                    className={`p-2 border rounded-lg transition-all ${
                                      payGateway === gate.id 
                                        ? 'border-indigo-500 bg-indigo-500/10 text-white font-bold' 
                                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                                    }`}
                                  >
                                    {gate.name}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {portalPayError && (
                              <p className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1.5">
                                {portalPayError}
                              </p>
                            )}

                            <button
                              onClick={triggerPayFromPortal}
                              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 rounded-xl uppercase hover:shadow transition text-center text-[10px]"
                            >
                              Confirmar Pago Pasarela
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="py-20 text-slate-500 font-mono">
                  Por favor, selecciona un cliente para iniciar el demo del Portal.
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- TAB 3: AUTOMATION WORKFLOWS (ITEM 15) --- */}
        {activeSubTab === 'automations' && (
          <div className="space-y-6">
            <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl">
              <h3 className="text-sm font-bold text-white font-mono uppercase border-b border-slate-900 pb-3 mb-4">
                Administrador de Workflows & Disparadores Autónomos IP
              </h3>
              <p className="text-xs text-slate-400 leading-normal mb-5">
                Programa reglas automáticas de contingencia para la red WISP / FTTH. Al detectar cambios de estado en olt, antenas, cobros o alarmas, NugaCore ejecuta scripts de ROS RouterOS API o llamadas HTTP/WhatsApp autónomamente.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {automations.map(auto => (
                  <div key={auto.id} className="p-4 rounded-xl border border-slate-850 bg-slate-900/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
                        <span className="text-xs font-mono font-bold text-white uppercase bg-slate-800 border border-slate-700 py-0.5 px-2 rounded-full">
                          {auto.trigger}
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={auto.active}
                          onChange={() => toggleAutomation(auto.id)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white border border-slate-700"></div>
                      </label>
                    </div>

                    <p className="text-xs text-slate-300 font-sans">{auto.action}</p>

                    <div className="flex justify-between items-center text-[10px] text-slate-500 font-mono border-t border-slate-920/80 pt-2">
                      <span>Log Ejecuciones: <strong>{auto.active ? auto.logs : 0} logs</strong></span>
                      <span className="text-slate-400 font-bold uppercase text-[8px]">Workflow {auto.active ? 'Activo' : 'Pausado'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Simulated Live Action Sandbox */}
            <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 space-y-4">
                <span className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-widest block">Sandbox de Prueba de Eventos</span>
                <h4 className="text-sm font-bold text-white font-mono uppercase">Disparar Eventos Manuales</h4>
                <p className="text-xs text-slate-400 leading-normal">
                  Fuerza la ejecución de una simulación de evento para verificar la respuesta autónoma del bot en el feed de auditoría de red de MikroTik ROS.
                </p>

                <div className="space-y-2 font-mono">
                  <button
                    onClick={() => executeSimulation('Pago de Factura')}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-left p-2.5 border border-slate-800 rounded-xl text-xs hover:text-indigo-400 transition flex items-center space-x-2"
                  >
                    <Play className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Trigger: Cliente paga factura atrasada</span>
                  </button>

                  <button
                    onClick={() => executeSimulation('Falla Ping Torre (>150ms)')}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-left p-2.5 border border-slate-800 rounded-xl text-xs hover:text-amber-400 transition flex items-center space-x-2"
                  >
                    <Play className="w-3.5 h-3.5 text-amber-400" />
                    <span>Trigger: Falla Ping de Backhaul (&gt;150ms)</span>
                  </button>

                  <button
                    onClick={() => executeSimulation('Recordatorios Masivos')}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-left p-2.5 border border-slate-800 rounded-xl text-xs hover:text-teal-400 transition flex items-center space-x-2"
                  >
                    <Play className="w-3.5 h-3.5 text-teal-400" />
                    <span>Trigger: Ejecutar cobranza manual WhatsApp</span>
                  </button>
                </div>
              </div>

              {/* Console logs */}
              <div className="lg:col-span-8 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-mono font-bold text-slate-500 uppercase tracking-widest block mb-2">Simulador de Eventos en Tiempo Real</span>
                  <div className="bg-slate-900 border border-slate-820 rounded-xl p-3.5 font-mono text-[10px] space-y-2 h-[150px] overflow-y-auto text-indigo-300">
                    {testLog.length === 0 ? (
                      <span className="text-slate-600 block">Doble click o selecciona un trigger del panel izquierdo para analizar el workflow de automatización...</span>
                    ) : (
                      testLog.map((log, i) => (
                        <div key={i} className="border-b border-slate-950 pb-1 text-slate-300 leading-normal">
                          {log}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setTestLog([])}
                  className="text-[10px] text-slate-500 hover:text-white mt-2 self-start font-mono"
                >
                  Limpiar Log
                </button>
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

              <div className="space-y-3.5 max-h-[380px] overflow-y-auto">
                {filteredAuditLogs.map(log => (
                  <div key={log.id} className="p-3 bg-slate-900/40 border border-slate-900 rounded-xl flex items-start justify-between gap-3 text-xs font-mono">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white">{log.user}</span>
                        <span className="text-[9px] bg-slate-800 text-slate-400 border border-slate-700 px-1.5 py-0.2 rounded font-bold uppercase">
                          {log.role}
                        </span>
                      </div>
                      <p className="text-slate-300 text-xs leading-relaxed font-sans">{log.action}</p>
                      <span className="text-[9px] text-slate-500">Origen IP: {log.ip}</span>
                    </div>

                    <span className="text-[9px] text-slate-500 shrink-0 flex items-center">
                      <Clock className="w-3.5 h-3.5 text-slate-600 inline-block mr-1" />
                      {log.timestamp}
                    </span>
                  </div>
                ))}
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
                    <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">Fuerza verificación OAuth/OAuth2</span>
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

              {/* API Integration Key Mock Statuses */}
              <div className="bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-3.5">
                <span className="text-xs font-mono font-bold text-indigo-400 block uppercase tracking-wider">Servicio de APIs Externas</span>
                <h3 className="text-sm font-bold text-white font-mono uppercase">Estado de Integraciones</h3>

                <div className="space-y-2.5 text-xs font-mono font-semibold">
                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Stripe Gateway</span>
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase">Conectado (Live)</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-emerald-400" />
                      <span>WhatsApp Cloud API</span>
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase">Conectado (Live)</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span>Mikrotik ROS API</span>
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase">Port 8728 (Activa)</span>
                  </div>

                  <div className="flex justify-between items-center bg-slate-900/60 p-2 rounded-lg border border-slate-900">
                    <div className="flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-sky-400" />
                      <span>UISP API</span>
                    </div>
                    <span className="text-[9px] text-slate-500 uppercase">Conectado</span>
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
