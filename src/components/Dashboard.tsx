import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  AlertTriangle,
  TrendingUp,
  CreditCard,
  Wrench,
  Signal,
  Layers,
  Receipt,
  RefreshCw,
  CheckCircle,
  UserPlus,
  Ticket,
  Router as RouterIcon,
  Activity,
  ClipboardList,
  Brain,
  Bell,
  ChevronRight,
} from 'lucide-react';
import { NocAlert } from '../types';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';

// ====================================================================
// Dashboard Ejecutivo V3 — pantalla de DECISIÓN RÁPIDA para el dueño.
//
// Desaturado y enfocado: 8 KPIs principales (clickeables → su módulo),
// Alertas Importantes (máx. 5, priorizadas) y 5 Acciones Rápidas. Todo
// dentro del primer viewport en desktop.
//
// El tooling operativo del NOC (alertas en tiempo real, ping, simulador,
// umbrales/push, bot) se movió a NocOperationsPanel (tab NOC). El detalle de
// cobranza (Top 10, facturación/cobrado, etc.) vive en Facturación; la
// operación WISP (reservas, instalaciones) en sus módulos. Aquí NO se duplica.
//
// Sin tema nuevo: misma paleta slate/indigo, tema oscuro y tipografía.
// ====================================================================

interface DashboardProps {
  stats: any;
  alerts: NocAlert[];
  onRefresh: () => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  // Navegación a un módulo (cada KPI / alerta / acción es clickeable).
  onNavigate?: (tab: string) => void;
}

type ImportantSeverity = 'critical' | 'high' | 'warning' | 'info';

interface ImportantAlert {
  id: string;
  severity: ImportantSeverity;
  label: string;
  detail?: string;
  tab: string;
}

const SEVERITY_WEIGHT: Record<ImportantSeverity, number> = {
  critical: 0,
  high: 1,
  warning: 2,
  info: 3,
};

const SEVERITY_STYLES: Record<ImportantSeverity, { box: string; label: string; icon: string }> = {
  critical: { box: 'bg-rose-950/10 border-rose-500/30', label: 'text-rose-300', icon: 'text-rose-400' },
  high: { box: 'bg-orange-950/10 border-orange-500/30', label: 'text-orange-300', icon: 'text-orange-400' },
  warning: { box: 'bg-amber-950/10 border-amber-500/30', label: 'text-amber-200', icon: 'text-amber-400' },
  info: { box: 'bg-indigo-950/10 border-indigo-500/20', label: 'text-indigo-200', icon: 'text-indigo-400' },
};

export default function Dashboard({ stats, alerts, onRefresh, getAuthHeaders, onNavigate }: DashboardProps) {
  // KPIs ejecutivos de cobranza (cobranza del mes + facturas vencidas).
  const [billingKpis, setBillingKpis] = useState<any | null>(null);
  const [controlCenter, setControlCenter] = useState<any | null>(null);

  const loadBillingKpis = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [billingRes, ccRes] = await Promise.all([
        fetchWithRateLimitBackoff('/api/dashboard/billing-kpis', { headers }),
        fetchWithRateLimitBackoff('/api/dashboard/control-center', { headers }),
      ]);
      if (billingRes.ok) setBillingKpis(await billingRes.json());
      if (ccRes.ok) setControlCenter(await ccRes.json());
    } catch {
      // Read-only: si falla, el dashboard cae a los KPIs derivados de `stats`.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void loadBillingKpis();
  }, [loadBillingKpis]);

  const formatMXN = (num: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num || 0);

  const go = (tab: string) => () => onNavigate?.(tab);

  // ── Derivados (solo datos ya disponibles en stats/alerts/billingKpis) ──
  const towersOnline = stats.towers?.online ?? 0;
  const towersWarning = stats.towers?.warning ?? 0;
  const towersOffline = stats.towers?.offline ?? 0;
  const towersTotal = towersOnline + towersWarning + towersOffline;
  const capacityPct = Number(stats.wispOperations?.capacityUtilizationPercent || 0);
  const suspended = Number(stats.suspendedClients ?? 0);
  const activeTickets = Number(stats.activeTickets ?? 0);
  const facturasVencidas = Number(billingKpis?.facturasVencidas ?? 0);
  const cobradoMes = billingKpis?.cobradoMes ?? stats.cobranzaMes ?? 0;
  const provisioningPending = Number(stats.provisioningPending ?? 0);
  const automationQueue = Number(stats.automationQueue ?? 0);
  const notificationsPending = Number(stats.notificationsPending ?? 0);

  // ── 8 KPIs principales (clickeables → módulo) ─────────────────────────
  const KPIS: Array<{ id: string; label: string; value: string; icon: typeof Users; tone: string; tab: string }> = [
    // Fila 1
    { id: 'kpi-clientes-activos', label: 'Clientes Activos', value: String(stats.activeClients ?? 0), icon: Users, tone: 'text-indigo-400', tab: 'crm' },
    { id: 'kpi-suspendidos', label: 'Suspendidos', value: String(suspended), icon: AlertTriangle, tone: 'text-rose-400', tab: 'suspension' },
    { id: 'kpi-mrr', label: 'MRR', value: formatMXN(stats.mrr ?? 0), icon: TrendingUp, tone: 'text-emerald-400', tab: 'billing' },
    { id: 'kpi-cobranza-mes', label: 'Cobranza del Mes', value: formatMXN(cobradoMes), icon: CreditCard, tone: 'text-yellow-400', tab: 'payments' },
    // Fila 2
    { id: 'kpi-tickets', label: 'Tickets Abiertos', value: String(activeTickets), icon: Wrench, tone: 'text-amber-400', tab: 'support' },
    { id: 'kpi-torres', label: 'Torres Online', value: `${towersOnline}/${towersTotal}`, icon: Signal, tone: 'text-emerald-400', tab: 'network' },
    { id: 'kpi-capacidad', label: 'Capacidad Promedio', value: `${capacityPct.toFixed(1)}%`, icon: Layers, tone: 'text-sky-400', tab: 'inventory' },
    { id: 'kpi-facturas-vencidas', label: 'Facturas Vencidas', value: String(facturasVencidas), icon: Receipt, tone: 'text-rose-400', tab: 'billing' },
    { id: 'kpi-provisioning-pendiente', label: 'Provisioning Pendiente', value: String(provisioningPending), icon: ClipboardList, tone: 'text-indigo-400', tab: 'provisioning' },
    { id: 'kpi-automation-queue', label: 'Automation Queue', value: String(automationQueue), icon: Brain, tone: 'text-indigo-400', tab: 'automation' },
    { id: 'kpi-notifications-pending', label: 'Notificaciones Pendientes', value: String(notificationsPending), icon: Bell, tone: 'text-indigo-400', tab: 'notifications' },
  ];

  // ── Alertas importantes (curado, máx. 5, prioridad crit > high > warn) ──
  const derivedAlerts: ImportantAlert[] = [];
  if (towersOffline > 0) {
    derivedAlerts.push({ id: 'imp-torres-offline', severity: 'critical', label: `${towersOffline} torre(s) offline`, detail: 'Infraestructura sin servicio', tab: 'network' });
  }
  if (facturasVencidas > 0) {
    derivedAlerts.push({ id: 'imp-cobranza-vencida', severity: 'high', label: 'Cobranza vencida', detail: `${facturasVencidas} factura(s) vencida(s)`, tab: 'billing' });
  }
  if (capacityPct > 90) {
    derivedAlerts.push({ id: 'imp-capacidad', severity: 'warning', label: `Capacidad de red al ${capacityPct.toFixed(0)}%`, detail: 'Saturación próxima', tab: 'inventory' });
  }
  if (suspended > 0) {
    derivedAlerts.push({ id: 'imp-suspendidos', severity: 'warning', label: `${suspended} cliente(s) suspendido(s)`, detail: 'Revisar cobranza / servicio', tab: 'suspension' });
  }
  // Alertas reales del NOC sin reconocer (torre offline, router sin respuesta, ticket crítico…).
  const nocAlerts: ImportantAlert[] = alerts
    .filter((a) => !a.acknowledged && (a.severity === 'critical' || a.severity === 'warning'))
    .map((a) => ({
      id: `imp-noc-${a.id}`,
      severity: a.severity === 'critical' ? 'critical' : 'warning',
      label: a.source,
      detail: a.message,
      tab: 'noc',
    }));

  const importantAlerts: ImportantAlert[] = [...derivedAlerts, ...nocAlerts]
    .sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity])
    .slice(0, 5);

  // ── Acciones rápidas (5) ──────────────────────────────────────────────
  const QUICK_ACTIONS: Array<{ id: string; label: string; icon: typeof Users; tab: string }> = [
    { id: 'qa-nuevo-cliente', label: 'Nuevo Cliente', icon: UserPlus, tab: 'crm' },
    { id: 'qa-registrar-pago', label: 'Registrar Pago', icon: CreditCard, tab: 'payments' },
    { id: 'qa-crear-ticket', label: 'Crear Ticket', icon: Ticket, tab: 'support' },
    { id: 'qa-alta-router', label: 'Alta Router', icon: RouterIcon, tab: 'router-enrollment' },
    { id: 'qa-abrir-noc', label: 'Abrir NOC', icon: Activity, tab: 'noc' },
  ];

  return (
    <div className="space-y-6 text-slate-100 font-sans p-6 bg-slate-900 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Dashboard Ejecutivo NugaCore</h2>
          <p className="text-sm text-slate-400 font-mono mt-1">
            Pantalla de decisión rápida: suscriptores, ingresos, red y cobranza.
          </p>
        </div>
        <div className="flex items-center space-x-2.5">
          <button
            onClick={onRefresh}
            id="refresh-stats-btn"
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700 text-slate-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refrescar</span>
          </button>
          <span className="text-xs bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-mono px-3 py-1.5 rounded-lg">
            SLA de Red: {stats.executive?.towerAvailabilityPct ?? 99.98}%
          </span>
        </div>
      </div>

      {/* ═══ 8 KPIs PRINCIPALES (2 filas de 4, clickeables) ═══ */}
      <section id="dashboard-executive-kpis" aria-label="KPIs ejecutivos" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {KPIS.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.id}
              id={kpi.id}
              type="button"
              onClick={go(kpi.tab)}
              aria-label={`${kpi.label}: abrir módulo`}
              className="text-left bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition group relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] sm:text-xs text-slate-400 font-mono font-semibold uppercase">{kpi.label}</span>
                <Icon className={`w-4 h-4 ${kpi.tone}`} />
              </div>
              <div className="mt-3 text-2xl font-extrabold tracking-tight text-white truncate">{kpi.value}</div>
              <span className="mt-1 text-[10px] text-slate-500 font-mono group-hover:text-slate-300 transition flex items-center gap-0.5">
                Ver módulo <ChevronRight className="w-3 h-3" />
              </span>
            </button>
          );
        })}
      </section>

      {controlCenter && (
        <section id="dashboard-control-center" aria-label="Cabina de mando WISP" className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <h3 className="text-xs text-slate-400 font-mono uppercase tracking-widest mb-3">Cabina de Mando WISP OS</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <button type="button" onClick={go('crm')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600">
              <div className="text-slate-400 text-xs">Clientes</div>
              <div className="text-white font-semibold">{controlCenter.clients?.active} activos · {controlCenter.clients?.suspended} suspendidos</div>
              <div className="text-rose-400 text-xs">{controlCenter.clients?.morosos} morosos</div>
            </button>
            <button type="button" onClick={go('billing')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600">
              <div className="text-slate-400 text-xs">Finanzas mes</div>
              <div className="text-emerald-400 font-semibold">{formatMXN((controlCenter.finance?.revenueMonthCents ?? 0) / 100)}</div>
              <div className="text-amber-400 text-xs">{controlCenter.finance?.activePaymentPromises} promesas activas</div>
            </button>
            <button type="button" onClick={go('noc')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600">
              <div className="text-slate-400 text-xs">Red</div>
              <div className="text-white font-semibold">{controlCenter.network?.routersOnline}/{controlCenter.network?.routersOnline + controlCenter.network?.routersOffline} routers</div>
              <div className="text-slate-400 text-xs">{controlCenter.alerts?.nocOpen} alertas NOC</div>
            </button>
            <button type="button" onClick={go('support')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600">
              <div className="text-slate-400 text-xs">Tickets / Instalaciones</div>
              <div className="text-white font-semibold">{controlCenter.tickets?.open} abiertos</div>
              <div className="text-amber-400 text-xs">{controlCenter.installations?.pending} instalaciones pendientes</div>
            </button>
            <button type="button" onClick={go('suspension')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600">
              <div className="text-slate-400 text-xs">Cobranza / Cortes</div>
              <div className="text-rose-400 font-semibold">{controlCenter.collections?.clientsToSuspend} a cortar</div>
              <div className="text-emerald-400 text-xs">{controlCenter.collections?.clientsToReactivate} a reactivar</div>
            </button>
            <button type="button" onClick={go('commercial')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600">
              <div className="text-slate-400 text-xs">Agenda hoy</div>
              <div className="text-indigo-300 font-semibold">{controlCenter.installations?.scheduledToday} citas</div>
            </button>
            <button type="button" onClick={go('network')} className="text-left p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600 col-span-2">
              <div className="text-slate-400 text-xs">Capacidad red</div>
              <div className="text-white font-semibold">{controlCenter.capacity?.utilizationPct}% utilización</div>
            </button>
          </div>
        </section>
      )}

      {/* ═══ ALERTAS IMPORTANTES (máx. 5, priorizadas) ═══ */}
      <section id="dashboard-important-alerts" aria-label="Alertas importantes" className="space-y-2">
        <h3 className="text-xs text-slate-400 font-mono uppercase tracking-widest flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Alertas Importantes
        </h3>
        {importantAlerts.length === 0 ? (
          <div id="dashboard-alerts-empty" className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-5 flex items-center gap-2 text-sm text-slate-400">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Sin alertas importantes. Operación nominal.
          </div>
        ) : (
          <ul className="space-y-2">
            {importantAlerts.map((alert) => {
              const styles = SEVERITY_STYLES[alert.severity];
              return (
                <li key={alert.id}>
                  <button
                    type="button"
                    onClick={go(alert.tab)}
                    className={`w-full text-left flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 transition hover:brightness-110 ${styles.box}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <AlertTriangle className={`w-4 h-4 shrink-0 ${styles.icon}`} />
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${styles.label}`}>{alert.label}</p>
                        {alert.detail && <p className="text-[11px] text-slate-400 truncate">{alert.detail}</p>}
                      </div>
                    </div>
                    <span className="text-[9px] font-mono uppercase tracking-wide text-slate-500 shrink-0">{alert.severity}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ═══ ACCIONES RÁPIDAS (5) ═══ */}
      <section id="dashboard-quick-actions" aria-label="Acciones rápidas" className="space-y-2">
        <h3 className="text-xs text-slate-400 font-mono uppercase tracking-widest">Acciones Rápidas</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                id={action.id}
                type="button"
                onClick={go(action.tab)}
                className="flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm font-semibold text-slate-200 hover:border-indigo-500/40 hover:bg-slate-900 transition"
              >
                <Icon className="w-4 h-4 text-indigo-400" />
                <span className="truncate">{action.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
