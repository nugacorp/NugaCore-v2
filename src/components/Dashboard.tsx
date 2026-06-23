import React, { useState, useEffect, useCallback } from 'react';
import { 
  TrendingUp, 
  Users, 
  CreditCard, 
  Wrench, 
  Signal, 
  AlertTriangle, 
  CheckCircle, 
  Zap, 
  Clock, 
  Send,
  RefreshCw,
  Layers,
  PhoneCall,
  Bell,
  BellOff,
  Sliders,
  Play,
  Settings,
  Mail,
  MessageSquare
} from 'lucide-react';
import { NocAlert } from '../types';
import { fetchWithRateLimitBackoff, isApiRateLimitError } from '../lib/apiBackoff';

interface DashboardProps {
  stats: any;
  alerts: NocAlert[];
  onAcknowledgeAlerts: () => void;
  onRefresh: () => void;
  onPostAlert: (type: 'tower' | 'olt' | 'client' | 'system', severity: 'critical' | 'warning' | 'info', source: string, msg: string) => void;
  getAuthHeaders: () => Promise<Record<string, string>>;
  // Navegación opcional a un módulo (para los enlaces "ver detalle" del resumen).
  onNavigate?: (tab: string) => void;
}

export default function Dashboard({ stats, alerts, onAcknowledgeAlerts, onRefresh, onPostAlert, getAuthHeaders, onNavigate }: DashboardProps) {
  const [billingBotRunning, setBillingBotRunning] = useState(false);
  const [pingScanning, setPingScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any[]>([]);

  // Push Notifications States
  const [pushSettings, setPushSettings] = useState({
    pushEnabled: true,
    latencyThresholdMs: 120,
    fiberCutAlertEnabled: true,
    browserSubscribed: false,
    webhooksCount: 2
  });
  const [fetchingSettings, setFetchingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<string>('default');
  const [settingsRateLimited, setSettingsRateLimited] = useState<string>('');

  // Simulation parameters states
  const [simEventType, setSimEventType] = useState<'latency' | 'fibercut'>('latency');
  const [simLatencyValue, setSimLatencyValue] = useState<number>(185);
  const [simSource, setSimSource] = useState<string>('Enlace Troncal Guerrero-Acapulco Carrier SFP+');
  const [triggeringSimulation, setTriggeringSimulation] = useState(false);
  const [simLog, setSimLog] = useState<string[]>([]);

  // In-App floating toasts
  const [inAppToasts, setInAppToasts] = useState<any[]>([]);

  // KPIs ejecutivos de cobranza (FASE E — Billing Foundation).
  const [billingKpis, setBillingKpis] = useState<any | null>(null);

  const loadNotificationSettings = useCallback(async () => {
    try {
      setFetchingSettings(true);
      const headers = await getAuthHeaders();
      const response = await fetchWithRateLimitBackoff('/api/notifications/settings', {
        headers,
      }, {
        key: 'GET /api/notifications/settings',
        minBackoffMs: 8000,
      });

      if (!response.ok) {
        throw new Error(`status code ${response.status}`);
      }

      const data = await response.json();
      setPushSettings(data);
      setSettingsRateLimited('');
    } catch (err) {
      if (isApiRateLimitError(err)) {
        const seconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
        setSettingsRateLimited(`Demasiadas solicitudes, reintentando en ${seconds}s.`);
      } else {
        console.error('Error loading notification settings', err);
      }
    } finally {
      setFetchingSettings(false);
    }
  }, [getAuthHeaders]);

  const loadBillingKpis = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff('/api/dashboard/billing-kpis', { headers });
      if (res.ok) setBillingKpis(await res.json());
    } catch {
      // Read-only: si falla, el dashboard cae a los KPIs derivados de `stats`.
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void loadNotificationSettings();
    void loadBillingKpis();

    // Check browser permission status if supported
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, [loadNotificationSettings, loadBillingKpis]);

  const saveSettings = async (updated: typeof pushSettings) => {
    setSavingSettings(true);
    try {
      const res = await fetchWithRateLimitBackoff('/api/notifications/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify(updated)
      }, {
        key: 'POST /api/notifications/settings',
      });
      if (res.ok) {
        const data = await res.json();
        setPushSettings(data);
        setSettingsRateLimited('');
        triggerInAppToast("✔️ Configuración Guardada", "Los umbrales y canales push se guardaron correctamente en la base de datos de control.", "info");
      }
    } catch (err) {
      if (isApiRateLimitError(err)) {
        const seconds = Math.max(1, Math.ceil(err.retryAfterMs / 1000));
        setSettingsRateLimited(`Demasiadas solicitudes, reintentando en ${seconds}s.`);
      } else {
        console.error("Error saving settings", err);
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRequestPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const res = await Notification.requestPermission();
        setNotificationPermission(res);
        if (res === 'granted') {
          const updated = { ...pushSettings, browserSubscribed: true };
          await saveSettings(updated);
          triggerInAppToast("🔔 Notificaciones Habilitadas", "Este navegador ya está suscrito para alertas nativas en segundo plano.", "info");
        } else {
          triggerInAppToast("⚠️ Permiso Denegado", "El navegador bloqueó las notificaciones. Habilítalas en el candado de la barra de direcciones.", "warning");
        }
      } catch (err) {
        console.error(err);
      }
    } else {
      triggerInAppToast("🚫 Sin Soporte HTML5", "Este navegador no soporta Web Push Notifications de forma nativa.", "warning");
    }
  };

  const triggerInAppToast = (title: string, body: string, severity: 'critical' | 'warning' | 'info') => {
    const id = 'toast-' + Date.now();
    setInAppToasts(prev => [...prev, { id, title, body, severity }]);
    // Auto remove toast after 6 seconds
    setTimeout(() => {
      setInAppToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  };

  const executeSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    setTriggeringSimulation(true);
    try {
      const res = await fetch('/api/notifications/trigger-simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({
          eventType: simEventType,
          metricValue: simLatencyValue,
          source: simSource
        })
      });

      if (res.ok) {
        const data = await res.json();
        const stamp = new Date().toLocaleTimeString();
        
        if (data.triggered) {
          setSimLog(prev => [`[${stamp}] 🔔 EVENTO ENVIADO: ${data.message}`, ...prev]);
          
          // Trigger in-app UI Toast notification
          triggerInAppToast(
            data.notificationPayload.title,
            data.notificationPayload.body,
            simEventType === 'fibercut' ? 'critical' : 'warning'
          );

          // Trigger native browser notification if allowed
          if (notificationPermission === 'granted' && typeof window !== 'undefined' && 'Notification' in window) {
            try {
              new Notification(data.notificationPayload.title, {
                body: data.notificationPayload.body,
                icon: '/favicon.ico',
                tag: data.notificationPayload.tag
              });
            } catch (e) {
              console.warn("Unable to trigger native Notification instance (often due to iframe sandboxing):", e);
            }
          }

          // Force refresh NOC alerts list immediately
          await onRefresh();
        } else {
          setSimLog(prev => [`[${stamp}] ⚙️ EVENTO REGISTRADO (NO ENTRÓ): ${data.message}`, ...prev]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTriggeringSimulation(false);
    }
  };

  const formatMXN = (num: number) => {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
  };

  const triggerBillingBot = () => {
    setBillingBotRunning(true);
    setTimeout(() => {
      setBillingBotRunning(false);
      onPostAlert(
        'system',
        'info',
        'Finanzas Autopilot',
        'Recordatorio masivo enviado: Se canalizaron 3 alertas de WhatsApp/Email a clientes con facturas vencidas.'
      );
    }, 1500);
  };

  const executePingScan = () => {
    setPingScanning(true);
    setScanResults([]);
    setTimeout(() => {
      setScanResults([
        { destination: 'Gateway WAN IP (10.100.1.1)', pingValue: 4, label: 'Bajísimo', status: 'excelente' },
        { destination: 'Core DNS Google (8.8.8.8)', pingValue: 12, label: 'Excelente', status: 'excelente' },
        { destination: 'Torre del Valle AP (10.0.1.1)', pingValue: 8, label: 'Óptimo', status: 'excelente' },
        { destination: 'Torre Ajusco (10.0.1.3)', pingValue: 45, label: 'Alto (Fluctúa)', status: 'degradado' },
        { destination: 'OLT MA5800 SFP-S1 (10.200.1.1)', pingValue: 16, label: 'Normal (Fibra)', status: 'excelente' },
      ]);
      setPingScanning(false);
    }, 2000);
  };

  // ── Resumen operativo: deriva indicadores de prioridad usando SOLO datos ya
  // disponibles en `stats`/`alerts` (sin integraciones nuevas). ───────────────
  const towersOnline = stats.towers?.online ?? 0;
  const towersWarning = stats.towers?.warning ?? 0;
  const towersOffline = stats.towers?.offline ?? 0;
  const towersTotal = towersOnline + towersWarning + towersOffline;
  const activeAlertsCount = alerts.filter(a => !a.acknowledged).length;
  const criticalAlertsCount = alerts.filter(a => !a.acknowledged && a.severity === 'critical').length;
  const pendingToCollect = Math.max(0, (stats.facturacionMes ?? 0) - (stats.cobranzaMes ?? 0));
  const networkOk = towersOffline === 0 && criticalAlertsCount === 0;

  const go = (tab: string) => () => onNavigate?.(tab);

  // Tarjetas KPI del resumen operativo (orden por prioridad operativa).
  const operationalKpis: Array<{ label: string; value: string; tab: string; icon: typeof Users; tone: string }> = [
    { label: 'Suscriptores activos', value: String(stats.activeClients ?? 0), tab: 'crm', icon: Users, tone: 'text-indigo-400' },
    { label: 'Suspendidos', value: String(stats.suspendedClients ?? 0), tab: 'suspension', icon: AlertTriangle, tone: 'text-rose-400' },
    { label: 'Tickets abiertos', value: String(stats.activeTickets ?? 0), tab: 'support', icon: Wrench, tone: 'text-amber-400' },
    { label: 'Pendiente de cobro', value: formatMXN(pendingToCollect), tab: 'billing', icon: CreditCard, tone: 'text-yellow-400' },
    { label: 'Ingresos del mes', value: formatMXN(stats.mrr ?? 0), tab: 'finance', icon: TrendingUp, tone: 'text-emerald-400' },
  ];
  const wispOperations = stats.wispOperations || {};
  const clientsByTower = Array.isArray(wispOperations.clientsByTower)
    ? wispOperations.clientsByTower
    : [];
  const towerClientsTotal = clientsByTower.reduce(
    (sum: number, item: { activeClients?: number }) => sum + Number(item.activeClients || 0),
    0,
  );
  const towerSummary = clientsByTower
    .slice(0, 2)
    .map((item: { routerName?: string; activeClients?: number }) =>
      `${item.routerName || 'Nodo'}: ${item.activeClients || 0}`,
    )
    .join(' · ');
  const wispKpis: Array<{
    label: string;
    value: string;
    detail: string;
    tab: string;
    icon: typeof Users;
    tone: string;
  }> = [
    {
      label: 'Clientes por torre',
      value: String(towerClientsTotal),
      detail: towerSummary || 'Sin nodos registrados',
      tab: 'crm',
      icon: Users,
      tone: 'text-indigo-400',
    },
    {
      label: 'Capacidad utilizada',
      value: `${Number(wispOperations.capacityUtilizationPercent || 0).toFixed(1)}%`,
      detail: 'Promedio de routers y torres',
      tab: 'crm',
      icon: Signal,
      tone: 'text-amber-400',
    },
    {
      label: 'Equipos reservados',
      value: String(wispOperations.reservedEquipment || 0),
      detail: 'Reserva mock; stock sin cambios',
      tab: 'inventory',
      icon: Layers,
      tone: 'text-emerald-400',
    },
    {
      label: 'Instalaciones pendientes',
      value: String(wispOperations.pendingInstallations || 0),
      detail: 'Órdenes y reservas por atender',
      tab: 'support',
      icon: Wrench,
      tone: 'text-rose-400',
    },
  ];

  return (
    <div className="space-y-6 text-slate-100 font-sans p-6 bg-slate-900 min-h-screen">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Dashboard Ejecutivo NugaCore</h2>
          <p className="text-sm text-slate-400 font-mono mt-1">
            Perspectiva unificada de red, suscriptores y EBITDA / Ingreso Recurrente.
          </p>
        </div>
        <div className="flex items-center space-x-2.5">
          <button
            onClick={onRefresh}
            id="refresh-stats-btn"
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700 text-slate-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refrescar NOC</span>
          </button>
          <span className="text-xs bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-mono px-3 py-1.5 rounded-lg">
            SLA de Red: {stats.executive?.towerAvailabilityPct ?? 99.98}%
          </span>
        </div>
      </div>

      {/* ═══ RESUMEN OPERATIVO ═══
          Prioriza estado de red + alertas; luego KPIs clave enlazables a su
          módulo. Mismos estilos/colores existentes (sin tema nuevo). */}
      <section id="dashboard-operativo" className="space-y-4" aria-label="Resumen operativo">
        <h3 className="text-xs text-slate-400 font-mono uppercase tracking-widest">Resumen operativo</h3>

        {/* Estado general de la red + alertas NOC primero */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
              networkOk
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {networkOk ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-mono uppercase block">Estado general de la red</span>
              <span className={`text-sm font-bold ${networkOk ? 'text-emerald-400' : 'text-rose-400'}`}>
                {networkOk ? 'Red operativa' : 'Red requiere atención'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={go('noc')}
              className="flex items-center space-x-1.5 text-xs font-mono px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white transition"
            >
              <Bell className={`w-3.5 h-3.5 ${activeAlertsCount > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
              <span>{activeAlertsCount} alertas NOC</span>
            </button>
            <span className="text-xs font-mono px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-emerald-400">
              Torres {towersOnline}/{towersTotal} online
            </span>
            <span className={`text-xs font-mono px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 ${
              towersOffline > 0 ? 'text-rose-400' : 'text-slate-400'
            }`}>
              {towersOffline} offline
            </span>
          </div>
        </div>

        {/* KPIs operativos clave (compactos, enlazables a su módulo) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {operationalKpis.map(kpi => {
            const Icon = kpi.icon;
            return (
              <button
                key={kpi.label}
                type="button"
                onClick={go(kpi.tab)}
                className="text-left bg-slate-950 border border-slate-800 rounded-xl p-3.5 hover:border-slate-700 transition group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono uppercase">{kpi.label}</span>
                  <Icon className={`w-4 h-4 ${kpi.tone}`} />
                </div>
                <div className="mt-2 text-xl font-extrabold tracking-tight text-white truncate">{kpi.value}</div>
                <span className="text-[10px] text-slate-500 font-mono group-hover:text-slate-300 transition">Ver detalle →</span>
              </button>
            );
          })}
        </div>
      </section>

      <section id="dashboard-wisp-operations" className="space-y-3" aria-label="Operación WISP">
        <h3 className="text-xs text-slate-400 font-mono uppercase tracking-widest">Operación WISP</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {wispKpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <button
                key={kpi.label}
                type="button"
                onClick={go(kpi.tab)}
                className="text-left bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono uppercase">{kpi.label}</span>
                  <Icon className={`w-4 h-4 ${kpi.tone}`} />
                </div>
                <div className="mt-2 text-2xl font-extrabold tracking-tight text-white">{kpi.value}</div>
                <p className="mt-1 text-[10px] text-slate-500 font-mono truncate">{kpi.detail}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Bento Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Subscriber Box */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono font-semibold uppercase">Suscriptores Activos</span>
            <Users className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="mt-4 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold tracking-tight text-white">{stats.activeClients}</span>
            <span className="text-xs text-slate-400">hogares/suc</span>
          </div>
          <div className="mt-2 flex items-center space-x-1 text-xs text-emerald-400 font-semibold">
            <span className="bg-emerald-500/15 py-0.5 px-1.5 rounded text-[10px] border border-emerald-500/20">
              +{stats.leadsCount} Prospectos
            </span>
            <span className="font-mono font-light text-slate-500">en embudo</span>
          </div>
          <div className="absolute right-[-10px] bottom-[-10px] w-14 h-14 bg-indigo-500/5 rounded-full blur-xl group-hover:bg-indigo-500/10 transition"></div>
        </div>

        {/* EBITDA / MRR Account */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono font-semibold uppercase">Ingreso Recurrente (MRR)</span>
            <TrendingUp className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="mt-4 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold tracking-tight text-white">{formatMXN(stats.mrr)}</span>
            <span className="text-xs text-slate-400">mensual</span>
          </div>
          <div className="mt-2 flex items-center space-x-1 text-xs text-slate-400">
            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1 py-0.5 rounded text-[10px]">
              Crec. Mes {stats.growth?.revenueMonthlyPct ?? 0}%
            </span>
            <span>Cobranza efectiva {stats.executive?.collectionRatePct ?? 0}%</span>
          </div>
          <div className="absolute right-[-10px] bottom-[-10px] w-14 h-14 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition"></div>
        </div>

        {/* Collection Status */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono font-semibold uppercase">Cobranza Recaudada</span>
            <CreditCard className="w-5 h-5 text-yellow-400" />
          </div>
          <div className="mt-4 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold tracking-tight text-yellow-400">{formatMXN(stats.cobranzaMes)}</span>
            <span className="text-xs text-slate-400 font-mono">de {formatMXN(stats.facturacionMes)}</span>
          </div>
          <div className="mt-2 flex items-center space-x-1.5 text-xs">
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-yellow-400 h-1.5 rounded-full" 
                style={{ width: `${(stats.cobranzaMes / (stats.facturacionMes || 1)) * 100}%` }}
              ></div>
            </div>
            <span className="text-[10px] text-slate-300 font-mono">
              {Math.round((stats.cobranzaMes / (stats.facturacionMes || 1)) * 100)}%
            </span>
          </div>
          <div className="absolute right-[-10px] bottom-[-10px] w-14 h-14 bg-yellow-500/5 rounded-full blur-xl group-hover:bg-yellow-500/10 transition"></div>
        </div>

        {/* SLA Tickets & Alarm */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 relative overflow-hidden group hover:border-slate-700 transition">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-mono font-semibold uppercase">SLA Tickets / Alarmas</span>
            <Wrench className="w-5 h-5 text-rose-400" />
          </div>
          <div className="mt-4 flex items-baseline space-x-2">
            <span className="text-3xl font-extrabold tracking-tight text-white">{stats.activeTickets}</span>
            <span className="text-xs text-slate-400">abiertos</span>
          </div>
          <div className="mt-2 flex items-center space-x-1 text-xs text-orange-400">
            {stats.activeTickets > 0 ? (
              <span className="flex items-center space-x-1 animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span>Requieren atención técnica</span>
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center space-x-1">
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Resolución {stats.executive?.ticketResolutionPct ?? 100}%</span>
              </span>
            )}
          </div>
          <div className="absolute right-[-10px] bottom-[-10px] w-14 h-14 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition"></div>
        </div>
      </div>

      {/* ── Cobranza Ejecutiva (FASE E — Billing Foundation) ──────────── */}
      <section id="dashboard-billing-kpis" aria-label="Cobranza ejecutiva" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-yellow-400" /> Cobranza Ejecutiva
          </h3>
          <button
            onClick={go('billing')}
            className="text-[10px] font-mono uppercase tracking-wide text-indigo-400 hover:text-indigo-300"
          >
            Ver facturación →
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: 'Facturación del mes', value: formatMXN(billingKpis?.facturacionMes ?? stats.facturacionMes ?? 0), tone: 'text-emerald-400' },
            { label: 'Cobrado del mes', value: formatMXN(billingKpis?.cobradoMes ?? stats.cobranzaMes ?? 0), tone: 'text-yellow-400' },
            { label: 'Pendiente de cobro', value: formatMXN(billingKpis?.pendienteCobro ?? pendingToCollect), tone: 'text-amber-400' },
            { label: 'Clientes con adeudo', value: String(billingKpis?.clientesConAdeudo ?? 0), tone: 'text-orange-400' },
            { label: 'Facturas vencidas', value: String(billingKpis?.facturasVencidas ?? 0), tone: 'text-rose-400' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-slate-950 border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition">
              <span className="text-[10px] text-slate-400 font-mono font-semibold uppercase block">{kpi.label}</span>
              <span className={`mt-2 block text-2xl font-extrabold tracking-tight ${kpi.tone}`}>{kpi.value}</span>
            </div>
          ))}
        </div>

        {/* Top 10 adeudos */}
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
          <h4 className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-3">Top 10 Adeudos</h4>
          {Array.isArray(billingKpis?.topAdeudos) && billingKpis.topAdeudos.length > 0 ? (
            <ul className="divide-y divide-slate-900">
              {billingKpis.topAdeudos.map((row: any, i: number) => (
                <li key={row.invoiceId} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-mono text-slate-600 w-5 shrink-0">{i + 1}.</span>
                    <span className="text-[12px] text-slate-200 truncate">{row.clientName}</span>
                    {row.status === 'overdue' && (
                      <span className="text-[9px] font-mono uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20 px-1.5 py-0.5 rounded shrink-0">Vencida</span>
                    )}
                  </div>
                  <span className="text-[12px] font-mono font-bold text-amber-400 shrink-0">{formatMXN(row.pendingAmount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p id="dashboard-billing-empty" className="text-[12px] text-slate-500 text-center py-4">Sin adeudos registrados.</p>
          )}
        </div>
      </section>

      {/* Main Panel grid: NOC monitoring feed & Quick tools */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Active NOC Alerts (8 columns) */}
        <div className="lg:col-span-8 bg-slate-950 border border-slate-800 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-1">
                  <span>Alertas del NOC en Tiempo Real</span>
                </h3>
              </div>
              <button
                onClick={onAcknowledgeAlerts}
                id="ack-all-alerts"
                className="text-xs text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-lg font-mono transition"
              >
                Silenciar / Limpiar Alertas
              </button>
            </div>

            {/* List */}
            {alerts.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500">
                <CheckCircle className="w-12 h-12 text-emerald-500/30 mb-3" />
                <p className="text-sm">No hay alarmas activas. Todo el sistema está Operando Nominalmente.</p>
                <p className="text-xs font-mono text-slate-600 mt-1">OLT Sube, GPON Postes, WISP Sectores en estado idóneo.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    id={`noc-alert-${alert.id}`}
                    className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 text-sm transition-all duration-300 ${
                      alert.acknowledged 
                        ? 'bg-slate-950/40 border-slate-900 opacity-60' 
                        : alert.severity === 'critical'
                          ? 'bg-rose-950/10 border-rose-500/30 text-rose-200'
                          : alert.severity === 'warning'
                            ? 'bg-amber-950/10 border-amber-500/30 text-amber-200'
                            : 'bg-indigo-950/10 border-indigo-500/20 text-indigo-200'
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className="mt-0.5 shrink-0">
                        {alert.severity === 'critical' ? (
                          <div className="w-6 h-6 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center border border-rose-500/40">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                        ) : alert.severity === 'warning' ? (
                          <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/40">
                            <Signal className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white tracking-tight">{alert.source}</span>
                          <span className="text-[10px] bg-slate-800 border border-slate-700 font-mono text-slate-400 px-1.5 py-0.2 rounded uppercase">
                            {alert.sourceType}
                          </span>
                        </div>
                        <p className="text-slate-300 mt-1 font-sans text-xs leading-relaxed">{alert.message}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-mono text-slate-500 flex items-center space-x-1">
                        <Clock className="w-3 h-3 text-slate-600 inline-block mr-1" />
                        {alert.timestamp}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Metrics */}
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-900 pt-4 text-center">
            <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-900/80">
              <span className="text-[10px] text-slate-500 font-mono uppercase block">Torres Wisp</span>
              <span className="text-sm font-semibold text-emerald-400">
                {stats.towers.online} / {stats.towers.online + stats.towers.warning + stats.towers.offline} Online
              </span>
            </div>
            <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-900/80">
              <span className="text-[10px] text-slate-500 font-mono uppercase block">Aprovisionados FTTH</span>
              <span className="text-sm font-semibold text-indigo-400">
                {stats.oltStats.connected} ONUs de fibra
              </span>
            </div>
            <div className="bg-slate-900/40 p-2.5 rounded-lg border border-slate-900/80">
              <span className="text-[10px] text-slate-500 font-mono uppercase block">Suspensiones</span>
              <span className="text-sm font-semibold text-rose-400">
                {stats.suspendedClients} Bloquedos ISP
              </span>
            </div>
          </div>
        </div>

        {/* Quick automation tools & Ping diagnostic (4 columns) */}
        <div className="lg:col-span-4 space-y-6">
          {/* Automation Bot Box */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 relative overflow-hidden">
            <h3 className="text-base font-bold text-white mb-2 flex items-center space-x-2">
              <Zap className="w-4 h-4 text-indigo-400 animate-pulse" />
              <span>Nuga Automations</span>
            </h3>
            <p className="text-xs text-slate-400 font-sans leading-relaxed mb-4">
              Dispara el proceso automático de análisis de adeudos de la cartera de clientes.
              El bot enviará recordatorios automáticos vía WhatsApp y suspenderá en MikroTik de forma inmediata a los deudores sin convenios activos.
            </p>
            <button
              onClick={triggerBillingBot}
              id="trigger-billing-bot"
              disabled={billingBotRunning}
              className={`w-full py-2.5 rounded-lg text-xs font-semibold tracking-wider uppercase transition border font-mono flex items-center justify-center space-x-2 ${
                billingBotRunning 
                  ? 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-500/10'
              }`}
            >
              {billingBotRunning ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-white rounded-full animate-spin"></span>
                  <span>Ejecutando Cobranza...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  <span>Desplegar Bot Cobros</span>
                </>
              )}
            </button>
          </div>

          {/* Core Latency diagnostics tool */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-6">
            <h3 className="text-base font-bold text-white mb-1.5 flex items-center space-x-2">
              <Signal className="w-4 h-4 text-emerald-400" />
              <span>Diagnóstico de Ping Core</span>
            </h3>
            <p className="text-xs text-slate-400 font-sans leading-relaxed mb-4">
              Realiza un test de latencia en tiempo real desde el router core NugaCore hacia destinos clave y enlaces backhaul.
            </p>

            <button
              onClick={executePingScan}
              id="test-pings-btn"
              disabled={pingScanning}
              className={`w-full py-2.5 rounded-lg text-xs font-semibold font-mono border transition flex items-center justify-center space-x-2 ${
                pingScanning
                  ? 'bg-slate-900 border-slate-800 text-slate-500'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
            >
              {pingScanning ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin"></span>
                  <span>Midiendo ICMP Latency...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Ecanear Latencias de Red</span>
                </>
              )}
            </button>

            {/* Results */}
            {scanResults.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-900 pt-3">
                {scanResults.map((res, i) => (
                  <div key={i} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400 truncate max-w-[180px]">{res.destination}</span>
                    <div className="flex items-center space-x-2">
                      <span className={res.status === 'excelente' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                        {res.pingValue} ms
                      </span>
                      <span className="text-[9px] bg-slate-950 border border-slate-900 px-1 rounded font-normal text-slate-500 uppercase">
                        {res.label}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION: CONFIGURATION OF CUSTOMIZABLE PUSH NOTIFICATIONS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
        
        {/* Left: Alerts Thresholds & Service Subscription */}
        <div className="lg:col-span-6 bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>Configuración de Umbrales & Alertas Push</span>
              </h3>
              <span className="text-[10px] bg-slate-900 border border-slate-800 text-indigo-400 px-2 py-0.5 rounded-full font-mono uppercase">Noc v2.2</span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Configura límites personalizados para que NugaCore dispare notificaciones Push inmediatas al NOC, personal de campo y directores ejecutivos ante degradaciones de red.
            </p>

            {settingsRateLimited && (
              <div className="text-[11px] font-mono text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2">
                {settingsRateLimited}
              </div>
            )}

            {fetchingSettings ? (
              <div className="py-6 text-center text-slate-500 font-mono text-xs">
                Cargando configuración del servidor...
              </div>
            ) : (
              <div className="space-y-4 font-mono text-xs">
                
                {/* Latency Threshold Slider */}
                <div className="bg-slate-900/50 border border-slate-850 p-4 rounded-xl space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300 font-medium">Umbral Máximo de Latencia</span>
                    <span className="text-indigo-400 font-bold bg-indigo-950/60 border border-indigo-900/50 px-2 py-0.5 rounded text-[11px]">
                      {pushSettings.latencyThresholdMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="300"
                    step="10"
                    value={pushSettings.latencyThresholdMs}
                    onChange={e => setPushSettings({ ...pushSettings, latencyThresholdMs: Number(e.target.value) })}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500">
                    <span>50ms (Ultra estricto)</span>
                    <span>300ms (Crit. Backhaul)</span>
                  </div>
                </div>

                {/* Fiber Cut Detection Switch */}
                <div className="flex items-center justify-between bg-slate-900/50 border border-slate-850 p-3 rounded-xl">
                  <div>
                    <span className="text-slate-300 block font-medium">Monitorear Cortes de Fibra</span>
                    <span className="text-[10px] text-slate-500 block">Detectar atenuación abrupta en OLT &gt; -40dB</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pushSettings.fiberCutAlertEnabled}
                      onChange={e => setPushSettings({ ...pushSettings, fiberCutAlertEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-850 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-gray-500 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white border border-slate-800"></div>
                  </label>
                </div>

                {/* Global Notification Service Switch */}
                <div className="flex items-center justify-between bg-slate-900/50 border border-slate-850 p-3 rounded-xl">
                  <div>
                    <span className="text-slate-300 block font-medium">Habilitar Servicio Push Global</span>
                    <span className="text-[10px] text-slate-500 block">Despachar notificaciones multipropósito</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pushSettings.pushEnabled}
                      onChange={e => setPushSettings({ ...pushSettings, pushEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-850 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-gray-500 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white border border-slate-800"></div>
                  </label>
                </div>

                {/* Browser Subscription Channel */}
                <div className="bg-slate-900/50 border border-slate-850 p-3.5 rounded-xl space-y-3">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-slate-300 font-medium font-sans">Estatus Push en este Navegador:</span>
                    {notificationPermission === 'granted' ? (
                      <span className="text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] uppercase">
                        🟢 Suscrito
                      </span>
                    ) : notificationPermission === 'denied' ? (
                      <span className="text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded text-[10px] uppercase">
                        ❌ Denegado
                      </span>
                    ) : (
                      <span className="text-amber-400 font-bold bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] uppercase">
                        ⚠️ Inactivo
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleRequestPermission}
                    className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-750 text-slate-350 py-2 rounded-lg text-[10px] font-bold uppercase transition flex items-center justify-center space-x-1"
                  >
                    <Bell className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Suscribir Notificaciones de Escritorio</span>
                  </button>
                </div>

                {/* Additional Active Channels Info block */}
                <div className="pt-2">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block mb-2 font-sans">Canales de Despacho Activos</span>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="bg-slate-900/30 border border-slate-850 rounded-lg p-2 flex items-center space-x-2 text-slate-400">
                      <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                      <span>Telegram Bot (NOC)</span>
                    </div>
                    <div className="bg-slate-900/30 border border-slate-850 rounded-lg p-2 flex items-center space-x-2 text-slate-400">
                      <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />
                      <span>WhatsApp API Gateway</span>
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          <button
            onClick={() => saveSettings(pushSettings)}
            disabled={savingSettings || fetchingSettings}
            className="w-full mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold font-mono text-xs py-2.5 rounded-lg transition-all shadow-md shadow-indigo-500/10 border border-indigo-500/30 font-bold tracking-wider uppercase cursor-pointer"
          >
            {savingSettings ? "Guardando cambios en servidor..." : "Guardar Parámetros de Alerta"}
          </button>
        </div>

        {/* Right: Interactive Event/Alert Push Simulation */}
        <div className="lg:col-span-6 bg-slate-950 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2">
                <Play className="w-4 h-4 text-emerald-400" />
                <span>Consola Simuladora de Eventos Críticos</span>
              </h3>
              <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono uppercase">SandBox API</span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Prueba de extremo a extremo tus reglas de filtrado de alertas. Forzar un evento enviará la trama ICMP / SNMP correspondiente y disparará notificaciones visuales e integradas.
            </p>

            <form onSubmit={executeSimulation} className="space-y-3 font-mono text-xs">
              
              {/* Event Type Tabs */}
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1.5">1. Seleccionar Evento</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSimEventType('latency')}
                    className={`py-2 px-3 border rounded-lg transition-all font-mono text-[10px] font-bold ${
                      simEventType === 'latency'
                        ? 'border-indigo-500 bg-indigo-500/10 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    Latencia Elevada en Backhaul
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimEventType('fibercut');
                      setSimSource('Anillo de Fibra GPON Centro - Sector N1');
                    }}
                    className={`py-2 px-3 border rounded-lg transition-all font-mono text-[10px] font-bold ${
                      simEventType === 'fibercut'
                        ? 'border-indigo-500 bg-indigo-500/10 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    Simular Corte de Fibra
                  </button>
                </div>
              </div>

              {/* Metric/Value Configuration (Only if Event Type is Latency) */}
              {simEventType === 'latency' && (
                <div className="bg-slate-900/30 border border-slate-900 p-3.5 rounded-xl space-y-2">
                  <div className="flex justify-between text-slate-400 text-[11px]">
                    <span>Latencia backhaul del test:</span>
                    <strong className="text-amber-400">{simLatencyValue} ms</strong>
                  </div>
                  <input
                    type="range"
                    min="30"
                    max="280"
                    step="5"
                    value={simLatencyValue}
                    onChange={e => setSimLatencyValue(Number(e.target.value))}
                    className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-slate-650">
                    <span>90ms (Normal)</span>
                    <span>{pushSettings.latencyThresholdMs}ms (Límite NOC)</span>
                    <span>250ms (Extremo)</span>
                  </div>
                </div>
              )}

              {/* Source Node Header and Input */}
              <div className="space-y-1">
                <span className="text-[10px] text-slate-500 uppercase font-bold block">2. Nodo / Origen del Evento</span>
                <input
                  type="text"
                  required
                  value={simSource}
                  onChange={e => setSimSource(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white placeholder-slate-650 text-[11px] focus:outline-none"
                />
              </div>

              {/* Trigger button */}
              <button
                type="submit"
                disabled={triggeringSimulation}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold font-mono py-2 rounded-lg transition text-[10px] uppercase flex items-center justify-center space-x-2 shadow-lg shadow-emerald-500/5"
              >
                {triggeringSimulation ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-slate-200 border-t-white rounded-full animate-spin"></span>
                    <span>Simulando Envío...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    <span>Disparar Alerta Simulada</span>
                  </>
                )}
              </button>

            </form>
          </div>

          {/* Console / Log panel for the simulation outputs */}
          <div className="mt-4">
            <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1 font-mono">Consola de Eventos Recibidos</span>
            <div className="bg-slate-900 border border-slate-850 rounded-lg p-3 h-20 overflow-y-auto text-[9.5px] font-mono text-sky-300 space-y-1">
              {simLog.length === 0 ? (
                <span className="text-slate-500 block italic">Doble clic o inicia un trigger arriba para capturar tramas SNMP...</span>
              ) : (
                simLog.map((log, index) => (
                  <div key={index} className="border-b border-slate-950 pb-0.5 last:border-b-0 leading-normal text-slate-350">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Floating Push Notification Toasts Absolute Display */}
      <div className="fixed bottom-6 right-6 z-50 space-y-3 pointer-events-none max-w-sm w-full">
        {inAppToasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-xl shadow-2xl border backdrop-blur-md flex items-start gap-3 transition-all duration-300 transform translate-x-0 cursor-pointer ${
              toast.severity === 'critical'
                ? 'bg-rose-950/95 border-rose-500 text-rose-100 ring-1 ring-rose-500/30'
                : toast.severity === 'warning'
                ? 'bg-amber-950/95 border-amber-500 text-amber-100 ring-1 ring-amber-500/30'
                : 'bg-indigo-950/95 border-indigo-500 text-indigo-150 ring-1 ring-indigo-500/30'
            }`}
            onClick={() => setInAppToasts(prev => prev.filter(t => t.id !== toast.id))}
          >
            <div className="shrink-0 mt-0.5">
              {toast.severity === 'critical' ? (
                <AlertTriangle className="w-5 h-5 text-rose-400 animate-pulse" />
              ) : toast.severity === 'warning' ? (
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              ) : (
                <Bell className="w-5 h-5 text-indigo-400 animate-bounce" />
              )}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-[9px] uppercase font-mono tracking-wider text-slate-400">Mensaje Push del NOC</span>
                <span className="text-[8px] text-slate-400 font-mono">Ahora</span>
              </div>
              <h4 className="font-bold text-xs text-white leading-tight">{toast.title}</h4>
              <p className="text-[11px] text-slate-300 leading-normal font-sans pt-0.5">{toast.body}</p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setInAppToasts(prev => prev.filter(t => t.id !== toast.id));
              }}
              className="text-slate-400 hover:text-white font-bold text-xs pl-2 shrink-0 self-start hover:scale-110 transition"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}
