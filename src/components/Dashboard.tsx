import React, { useState, useEffect } from 'react';
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
  PhoneCall
} from 'lucide-react';
import { NocAlert } from '../types';

interface DashboardProps {
  stats: any;
  alerts: NocAlert[];
  onAcknowledgeAlerts: () => void;
  onRefresh: () => void;
  onPostAlert: (type: 'tower' | 'olt' | 'client' | 'system', severity: 'critical' | 'warning' | 'info', source: string, msg: string) => void;
}

export default function Dashboard({ stats, alerts, onAcknowledgeAlerts, onRefresh, onPostAlert }: DashboardProps) {
  const [billingBotRunning, setBillingBotRunning] = useState(false);
  const [pingScanning, setPingScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any[]>([]);

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
            SLA de Red: 99.98%
          </span>
        </div>
      </div>

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
              EBITDA ~85%
            </span>
            <span>WISP de fibra de alta rentabilidad</span>
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
                <span>Soporte al día</span>
              </span>
            )}
          </div>
          <div className="absolute right-[-10px] bottom-[-10px] w-14 h-14 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition"></div>
        </div>
      </div>

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
    </div>
  );
}
