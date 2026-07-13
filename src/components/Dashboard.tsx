import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  AlertTriangle,
  TrendingUp,
  CreditCard,
  Wrench,
  Server,
  Receipt,
  RefreshCw,
  CheckCircle,
  UserPlus,
  Ticket,
  Router as RouterIcon,
  Activity,
  ChevronRight,
  Radio,
  Network,
  Satellite,
  Circle,
} from 'lucide-react';
import { NocAlert } from '../types';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';

// ====================================================================
// Dashboard Ejecutivo — decisión rápida y estado real por zona.
//
// Sin cabina duplicada: KPIs arriba + estado de equipos por zona + alertas
// accionables + acciones rápidas. Las torres solo nombran el lugar; el
// foco es router, switch, radio y GPS con estado operativo.
// ====================================================================

interface DashboardProps {
  stats: any;
  alerts: NocAlert[];
  onRefresh: () => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onNavigate?: (tab: string) => void;
}

type EquipmentStatus = 'online' | 'warning' | 'critical' | 'offline';
type EquipmentRole = 'router' | 'switch' | 'radio' | 'gps' | 'other';

interface ZoneEquipment {
  id: string;
  name: string;
  role: EquipmentRole;
  status: EquipmentStatus;
  brand: string;
  detail?: string;
}

interface ZoneRow {
  zoneId: string;
  zoneName: string;
  siteStatus: 'online' | 'warning' | 'offline';
  overallStatus: EquipmentStatus;
  equipmentOnline: number;
  equipmentTotal: number;
  equipment: ZoneEquipment[];
}

interface ZoneReport {
  summary: {
    zonesTotal: number;
    zonesOperational: number;
    zonesDegraded: number;
    zonesCritical: number;
    equipmentOnline: number;
    equipmentTotal: number;
    networkSlaPct: number;
  };
  zones: ZoneRow[];
}

type ImportantSeverity = 'critical' | 'high' | 'warning';

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
};

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  online: 'Operativo',
  warning: 'Degradado',
  critical: 'Crítico',
  offline: 'Sin respuesta',
};

const STATUS_DOT: Record<EquipmentStatus, string> = {
  online: 'bg-emerald-400',
  warning: 'bg-amber-400',
  critical: 'bg-rose-500',
  offline: 'bg-slate-500',
};

const ZONE_BADGE: Record<EquipmentStatus, string> = {
  online: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-200 border-amber-500/30',
  critical: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  offline: 'bg-slate-700/40 text-slate-300 border-slate-600',
};

const ROLE_ICON: Record<EquipmentRole, typeof Server> = {
  router: RouterIcon,
  switch: Network,
  radio: Radio,
  gps: Satellite,
  other: Server,
};

const ROLE_LABEL: Record<EquipmentRole, string> = {
  router: 'Router',
  switch: 'Switch',
  radio: 'Radio/AP',
  gps: 'GPS',
  other: 'Equipo',
};

export default function Dashboard({ stats, alerts, onRefresh, getAuthHeaders, onNavigate }: DashboardProps) {
  const [billingKpis, setBillingKpis] = useState<any | null>(null);
  const [zoneReport, setZoneReport] = useState<ZoneReport | null>(null);

  const loadDashboardData = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [billingRes, zonesRes] = await Promise.all([
        fetchWithRateLimitBackoff('/api/dashboard/billing-kpis', { headers }),
        fetchWithRateLimitBackoff('/api/dashboard/zones', { headers }),
      ]);
      if (billingRes.ok) setBillingKpis(await billingRes.json());
      if (zonesRes.ok) setZoneReport(await zonesRes.json());
    } catch {
      // Read-only: cae a KPIs derivados de stats si falla la red.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const formatMXN = (num: number) =>
    new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num || 0);

  const go = (tab: string) => () => onNavigate?.(tab);

  const suspended = Number(stats.suspendedClients ?? 0);
  const activeTickets = Number(stats.activeTickets ?? 0);
  const facturasVencidas = Number(billingKpis?.facturasVencidas ?? 0);
  const cobradoMes = billingKpis?.cobradoMes ?? stats.cobranzaMes ?? 0;
  const equipmentOnline = zoneReport?.summary.equipmentOnline ?? 0;
  const equipmentTotal = zoneReport?.summary.equipmentTotal ?? 0;
  const zonesCritical = (zoneReport?.summary.zonesDegraded ?? 0) + (zoneReport?.summary.zonesCritical ?? 0);
  const networkSla = zoneReport?.summary.networkSlaPct ?? stats.executive?.towerAvailabilityPct ?? 100;
  const activeAlerts = alerts.filter((a) => !a.acknowledged).length;

  const KPIS = [
    { id: 'kpi-clientes-activos', label: 'Clientes activos', value: String(stats.activeClients ?? 0), icon: Users, tone: 'text-indigo-400', tab: 'crm', hint: 'Suscriptores con servicio' },
    { id: 'kpi-suspendidos', label: 'Suspendidos', value: String(suspended), icon: suspended > 0 ? AlertTriangle : CheckCircle, tone: suspended > 0 ? 'text-rose-400' : 'text-emerald-400', tab: 'suspension', hint: suspended > 0 ? 'Requieren revisión' : 'Sin cortes activos' },
    { id: 'kpi-mrr', label: 'MRR', value: formatMXN(stats.mrr ?? 0), icon: TrendingUp, tone: 'text-emerald-400', tab: 'billing', hint: 'Ingreso recurrente esperado' },
    { id: 'kpi-cobranza-mes', label: 'Cobrado del mes', value: formatMXN(cobradoMes), icon: CreditCard, tone: 'text-yellow-400', tab: 'payments', hint: 'Pagos registrados este mes' },
    { id: 'kpi-tickets', label: 'Tickets abiertos', value: String(activeTickets), icon: Wrench, tone: activeTickets > 0 ? 'text-amber-400' : 'text-slate-400', tab: 'support', hint: activeTickets > 0 ? 'Soporte pendiente' : 'Cola limpia' },
    { id: 'kpi-equipos', label: 'Equipos en línea', value: equipmentTotal > 0 ? `${equipmentOnline}/${equipmentTotal}` : '—', icon: Server, tone: equipmentOnline === equipmentTotal && equipmentTotal > 0 ? 'text-emerald-400' : 'text-amber-400', tab: 'noc', hint: 'Router, switch, radio y GPS' },
    { id: 'kpi-facturas-vencidas', label: 'Facturas vencidas', value: String(facturasVencidas), icon: Receipt, tone: facturasVencidas > 0 ? 'text-rose-400' : 'text-slate-400', tab: 'billing', hint: facturasVencidas > 0 ? 'Cobranza urgente' : 'Al día' },
    { id: 'kpi-zonas', label: 'Zonas con incidencia', value: String(zonesCritical), icon: Activity, tone: zonesCritical > 0 ? 'text-rose-400' : 'text-emerald-400', tab: 'noc', hint: zonesCritical > 0 ? 'Revisar estado por zona' : 'Todas operativas' },
  ];

  const derivedAlerts: ImportantAlert[] = [];
  for (const zone of zoneReport?.zones ?? []) {
    if (zone.overallStatus === 'critical' || zone.overallStatus === 'offline') {
      derivedAlerts.push({
        id: `zone-${zone.zoneId}`,
        severity: 'critical',
        label: zone.zoneName,
        detail: `Zona ${STATUS_LABEL[zone.overallStatus].toLowerCase()} · ${zone.equipmentOnline}/${zone.equipmentTotal} equipos OK`,
        tab: 'noc',
      });
    } else if (zone.overallStatus === 'warning') {
      derivedAlerts.push({
        id: `zone-${zone.zoneId}`,
        severity: 'warning',
        label: zone.zoneName,
        detail: zone.equipment.find((e) => e.status !== 'online')?.detail ?? 'Equipo degradado en zona',
        tab: 'noc',
      });
    }
  }
  if (facturasVencidas > 0) {
    derivedAlerts.push({ id: 'imp-cobranza', severity: 'high', label: 'Cobranza vencida', detail: `${facturasVencidas} factura(s)`, tab: 'billing' });
  }
  if (suspended > 0) {
    derivedAlerts.push({ id: 'imp-suspendidos', severity: 'warning', label: `${suspended} cliente(s) suspendido(s)`, tab: 'suspension' });
  }

  const nocAlerts: ImportantAlert[] = alerts
    .filter((a) => !a.acknowledged && (a.severity === 'critical' || a.severity === 'warning'))
    .map((a) => ({
      id: `noc-${a.id}`,
      severity: a.severity === 'critical' ? 'critical' : 'warning',
      label: a.source,
      detail: a.message,
      tab: 'noc',
    }));

  const importantAlerts = [...derivedAlerts, ...nocAlerts]
    .sort((a, b) => SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity])
    .slice(0, 5);

  const QUICK_ACTIONS = [
    { id: 'qa-nuevo-cliente', label: 'Nuevo cliente', icon: UserPlus, tab: 'crm' },
    { id: 'qa-registrar-pago', label: 'Registrar pago', icon: CreditCard, tab: 'payments' },
    { id: 'qa-crear-ticket', label: 'Crear ticket', icon: Ticket, tab: 'support' },
    { id: 'qa-alta-router', label: 'Alta router', icon: RouterIcon, tab: 'router-enrollment' },
    { id: 'qa-abrir-noc', label: 'Abrir NOC', icon: Activity, tab: 'noc' },
  ];

  return (
    <div className="space-y-6 text-slate-100 font-sans p-6 bg-slate-900 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Dashboard Ejecutivo</h2>
          <p className="text-sm text-slate-400 mt-1">
            KPIs de negocio y estado real de equipos por zona.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => { onRefresh(); void loadDashboardData(); }}
            id="refresh-stats-btn"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700 text-slate-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refrescar</span>
          </button>
          <span className="text-xs bg-slate-800 border border-slate-700 text-slate-300 font-mono px-3 py-1.5 rounded-lg">
            SLA red {networkSla}%
          </span>
          {activeAlerts > 0 && (
            <span className="text-xs bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono px-3 py-1.5 rounded-lg">
              {activeAlerts} alerta{activeAlerts === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <section id="dashboard-executive-kpis" aria-label="KPIs ejecutivos" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {KPIS.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <button
              key={kpi.id}
              id={kpi.id}
              type="button"
              onClick={go(kpi.tab)}
              className="text-left bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-600 transition group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">{kpi.label}</span>
                <Icon className={`w-4 h-4 ${kpi.tone}`} />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-white">{kpi.value}</div>
              <p className="mt-1 text-[11px] text-slate-500">{kpi.hint}</p>
            </button>
          );
        })}
      </section>

      <section id="dashboard-zone-status" aria-label="Estado por zona" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Estado por zona</h3>
          <button type="button" onClick={go('noc')} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            Ver NOC completo <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {!zoneReport ? (
          <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-8 text-center text-sm text-slate-500">
            Cargando estado de zonas…
          </div>
        ) : zoneReport.zones.length === 0 ? (
          <div className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-8 text-center text-sm text-slate-500">
            Sin zonas registradas. Configura sitios en Red.
          </div>
        ) : (
          <div className="grid gap-3">
            {zoneReport.zones.map((zone) => (
              <button
                key={zone.zoneId}
                type="button"
                onClick={go('noc')}
                className="text-left bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-600 transition"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="text-base font-semibold text-white">{zone.zoneName}</p>
                    <p className="text-xs text-slate-500">
                      {zone.equipmentOnline}/{zone.equipmentTotal} equipos operativos
                    </p>
                  </div>
                  <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${ZONE_BADGE[zone.overallStatus]}`}>
                    {STATUS_LABEL[zone.overallStatus]}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {zone.equipment.map((item) => {
                    const Icon = ROLE_ICON[item.role];
                    return (
                      <div
                        key={item.id}
                        className="flex items-start gap-2.5 rounded-lg bg-slate-900/80 border border-slate-800 px-3 py-2"
                      >
                        <Icon className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Circle className={`w-2 h-2 fill-current ${STATUS_DOT[item.status]} text-transparent`} />
                            <span className="text-xs text-slate-300 truncate">{item.name}</span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {ROLE_LABEL[item.role]} · {item.brand}
                            {item.detail ? ` · ${item.detail}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section id="dashboard-important-alerts" aria-label="Alertas importantes" className="space-y-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          Alertas importantes
        </h3>
        {importantAlerts.length === 0 ? (
          <div id="dashboard-alerts-empty" className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-5 flex items-center gap-2 text-sm text-slate-400">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            Sin alertas. Operación nominal.
          </div>
        ) : (
          <ul className="space-y-2">
            {importantAlerts.map((alert) => (
              <li key={alert.id}>
                <button
                  type="button"
                  onClick={go(alert.tab)}
                  className={`w-full text-left flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition hover:border-slate-600 ${
                    alert.severity === 'critical'
                      ? 'bg-rose-950/20 border-rose-500/40'
                      : alert.severity === 'high'
                        ? 'bg-orange-950/15 border-orange-500/30'
                        : 'bg-amber-950/10 border-amber-500/25'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{alert.label}</p>
                    {alert.detail && <p className="text-xs text-slate-400 truncate">{alert.detail}</p>}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">{alert.severity}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="dashboard-quick-actions" aria-label="Acciones rápidas" className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Acciones rápidas</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                id={action.id}
                type="button"
                onClick={go(action.tab)}
                className="flex items-center justify-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-3 text-sm font-medium text-slate-200 hover:border-indigo-500/40 hover:bg-slate-900 transition"
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
