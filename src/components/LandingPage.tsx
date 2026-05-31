import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  ArrowRight, 
  Shield, 
  Activity, 
  Users, 
  Zap, 
  DollarSign, 
  MapPin, 
  CheckCircle, 
  AlertTriangle, 
  Sparkles, 
  Wifi, 
  Layers, 
  ClipboardCheck, 
  Eye, 
  Database, 
  TrendingUp, 
  Clock, 
  HeartHandshake, 
  BookOpen, 
  Server,
  ArrowUpRight,
  Calculator,
  Lock,
  ChevronRight
} from 'lucide-react';
import { UserSessionProfile, MOCK_USER_PROFILES } from '../lib/supabase';

interface LandingPageProps {
  onEnterLogin: () => void;
  onInstantDemo: (profile: UserSessionProfile) => void;
}

export default function LandingPage({ onEnterLogin, onInstantDemo }: LandingPageProps) {
  // Calculator States
  const [clientCount, setClientCount] = useState<number>(350);
  const [avgPlanPrice, setAvgPlanPrice] = useState<number>(25);
  const [currentOverhead, setCurrentOverhead] = useState<number>(15); // hours/week spent on simple billing chores
  
  // Dynamic Calculation metrics
  const estimatedMRR = clientCount * avgPlanPrice;
  const automatedBillingSavings = Math.round(currentOverhead * 0.9 * 4); // hours saved/month
  const estimatedCollectionBoost = Math.round(estimatedMRR * 0.12); // Average booster from automated suspension queues

  // ISP Live Ping Telemetry simulation state
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number>(0);
  const [mockPings, setMockPings] = useState<number[]>([12, 14, 15, 11, 10, 14, 11]);
  const [sysHealthPct, setSysHealthPct] = useState<number>(99.8);

  useEffect(() => {
    const interval = setInterval(() => {
      setMockPings(pings => {
        const next = Math.max(8, Math.min(48, pings[pings.length - 1] + (Math.random() * 10 - 5)));
        return [...pings.slice(1), Math.round(next)];
      });
      setSysHealthPct(h => Math.min(100, Math.max(98.5, h + (Math.random() * 0.2 - 0.1))));
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  const networkSegments = [
    { name: "Troncal Fibra (OLT-Haupt)", location: "NugaCorp HQ", load: "42%", status: "Optimo", rx: "-18.5 dBm" },
    { name: "Repetidor Sectorial Cerro Alto", location: "Torre Principal", load: "78%", status: "Warning", rx: "-64 dBm (Wireless)" },
    { name: "Zona Residencial Valle Oriente", location: "Caja NAP 12", load: "21%", status: "Optimo", rx: "-21.2 dBm" },
    { name: "Anillo Industrial Norte", location: "Fibra Troncal 3", load: "54%", status: "Optimo", rx: "-19.1 dBm" }
  ];

  const handleQuickDemoClick = (roleEmail: string) => {
    const profile = MOCK_USER_PROFILES.find(p => p.email === roleEmail);
    if (profile) {
      onInstantDemo(profile);
    }
  };

  return (
    <div id="nugacore-landing" className="min-h-screen bg-slate-950 font-sans text-slate-100 selection:bg-indigo-600/30 selection:text-white relative overflow-x-hidden">
      
      {/* Background visual filters / grids */}
      <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, #5b21b6 1px, transparent 1px)", backgroundSize: "28px 28px" }}></div>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-indigo-600/5 rounded-full blur-[150px] pointer-events-none"></div>
      <div className="absolute top-[800px] -right-40 w-[500px] h-[500px] bg-cyan-600/5 rounded-full blur-[130px] pointer-events-none"></div>
      <div className="absolute bottom-[200px] -left-40 w-[500px] h-[500px] bg-purple-600/5 rounded-full blur-[130px] pointer-events-none"></div>

      {/* STICKY HEADER */}
      <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-500 flex items-center justify-center shadow-lg shadow-indigo-600/15">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-extrabold text-lg text-white tracking-tight flex items-center">
                Nuga<span className="text-indigo-400">Core</span>
              </span>
              <span className="text-[9px] font-mono font-bold text-slate-500 bg-slate-900 border border-slate-800 px-1 py-0.5 rounded ml-2">ERP/NOC v2.4</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-7 text-xs font-mono text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">Módulos</a>
            <a href="#roi-calculator" className="hover:text-white transition-colors">Calculadora ROI</a>
            <a href="#telemetry" className="hover:text-white transition-colors">Simulación NOC</a>
            <a href="#demo-access" className="flex items-center space-x-1 text-indigo-400 hover:text-indigo-300">
              <Sparkles className="w-3.5 h-3.5 text-yellow-500 animate-pulse" />
              <span>Accesos Rápidos</span>
            </a>
          </nav>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleQuickDemoClick('admin@nugacorp.com')}
              className="hidden sm:inline-flex items-center px-4 py-2 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-900/60 rounded-xl text-xs font-semibold font-mono text-slate-300 transition"
            >
              Demo Admin (1-Clic)
            </button>
            <button
              onClick={onEnterLogin}
              className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition flex items-center space-x-1.5 shadow-md shadow-indigo-600/10"
            >
              <span>Acceder a la Consola</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-12 pb-20 sm:pb-28 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto text-center space-y-8">
          
          {/* Micro Tagline */}
          <div className="inline-flex items-center space-x-2 bg-indigo-950/40 border border-indigo-900/50 rounded-full px-4 py-1.5 text-xs text-indigo-300 font-mono">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
            <span>Estabilizando planta externa de fibra y wireless en tiempo real</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black text-white leading-[1.1] tracking-tight max-w-4xl mx-auto">
            La Consola Autónoma de <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 bg-clip-text text-transparent">
              Control Técnico y Comercial WISP/FTTH
            </span>
          </h1>

          <p className="text-sm sm:text-lg text-slate-400 max-w-3xl mx-auto leading-relaxed">
            Administra de punta a punta tu ISP. Controla facturación recurrente guiada por colas del router, suspende deudores automáticamente vía MikroTik APIs, y diagnositica incidentes con Copiloto de Inteligencia Artificial para el NOC.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 max-w-md mx-auto pt-4">
            <button
              onClick={onEnterLogin}
              className="w-full bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white py-3.5 px-6 rounded-2xl font-bold text-sm transition shadow-lg shadow-indigo-600/15 flex items-center justify-center space-x-2 text-center"
            >
              <span>Ingresar con mis Credenciales</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleQuickDemoClick('admin@nugacorp.com')}
              className="w-full bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 py-3.5 px-6 rounded-2xl font-semibold text-sm transition flex items-center justify-center space-x-2 text-center"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Instancias Demo Rápido</span>
            </button>
          </div>

          {/* Quick Metrics Line */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-10 border-t border-slate-900/80">
            <div className="bg-slate-900/55 p-4 rounded-2xl border border-slate-900">
              <span className="block text-2xl font-black text-white font-mono">0.05ms</span>
              <p className="text-[11px] text-slate-400 mt-1 uppercase font-mono tracking-wider">Latencia de Consulta API</p>
            </div>
            <div className="bg-slate-900/55 p-4 rounded-2xl border border-slate-900">
              <span className="block text-2xl font-black text-emerald-400 font-mono">99.98%</span>
              <p className="text-[11px] text-slate-400 mt-1 uppercase font-mono tracking-wider">SLA Promedio de Enlace</p>
            </div>
            <div className="bg-slate-900/55 p-4 rounded-2xl border border-slate-900">
              <span className="block text-2xl font-black text-indigo-400 font-mono">10,000+</span>
              <p className="text-[11px] text-slate-400 mt-1 uppercase font-mono tracking-wider">Abonados Gestionados</p>
            </div>
            <div className="bg-slate-900/55 p-4 rounded-2xl border border-slate-900">
              <span className="block text-2xl font-black text-purple-400 font-mono">100%</span>
              <p className="text-[11px] text-slate-400 mt-1 uppercase font-mono tracking-wider">Persistencia PostgreSQL</p>
            </div>
          </div>

        </div>
      </section>

      {/* MASTER GRAPHIC MOCKUP / TELEMETRY PREVIEW */}
      <section id="telemetry" className="py-12 bg-slate-950 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8 relative overflow-hidden backdrop-blur-sm">
            <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-[80px] pointer-events-none"></div>

            {/* left column - telemetry diagnostic controls */}
            <div className="lg:col-span-1 space-y-6">
              <div className="space-y-2">
                <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-indigo-950 border border-indigo-900/40 rounded-full text-[10px] text-indigo-300 font-mono uppercase tracking-wider">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  <span>NOC Telemetría Activa</span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black text-white">Monitoreo Holístico de Planta Externa</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Monitorea el estatus de las cajas NAP de fibra, sectoriales de los nodos WISP, repetidoras, niveles de atenuación óptica RX y latencias ping directamente desde de un solo tablero integrado.
                </p>
              </div>

              {/* simulated segments */}
              <div className="space-y-2.5">
                <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-500 block">Sectores de Red en Monitoreo</span>
                {networkSegments.map((seg, idx) => (
                  <button
                    key={seg.name}
                    onClick={() => setActiveSegmentIndex(idx)}
                    className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition ${
                      activeSegmentIndex === idx 
                        ? 'bg-slate-900/85 border-indigo-500/40' 
                        : 'bg-slate-950/50 border-slate-900/60 hover:bg-slate-900/20'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-white truncate">{seg.name}</p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">{seg.location}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                        seg.status === 'Optimo' 
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-900' 
                          : 'bg-amber-950 text-amber-400 border border-amber-900'
                      }`}>
                        {seg.rx}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* right columns - live network graph monitor and AI copilot preview */}
            <div className="lg:col-span-2 space-y-6 flex flex-col justify-between">
              
              {/* Graphic console component mockup */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-2xl p-4 sm:p-6 space-y-5">
                
                {/* Simulated Header */}
                <div className="flex items-center justify-between border-b border-slate-900 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <div>
                      <h4 className="text-xs font-bold text-white font-mono">Consola Diagnósticos Rápido</h4>
                      <p className="text-[10px] text-slate-500 font-mono">Mostrando métricas físicas de: <span className="text-slate-300 font-semibold">{networkSegments[activeSegmentIndex].name}</span></p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 font-mono block">Seguridad del Sistema NOC</span>
                    <span className="text-xs font-bold text-indigo-400 font-mono">{sysHealthPct.toFixed(2)}% Online</span>
                  </div>
                </div>

                {/* Simulated telemetry panel */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900/65 border border-slate-900 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-500 uppercase font-mono tracking-wider font-bold block">Atenuación Rx</span>
                    <span className={`text-sm font-extrabold font-mono mt-1 block ${
                      networkSegments[activeSegmentIndex].status === 'Optimo' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>{networkSegments[activeSegmentIndex].rx}</span>
                  </div>
                  <div className="bg-slate-900/65 border border-slate-900 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-500 uppercase font-mono tracking-wider font-bold block">Uso Enlace / Load</span>
                    <span className="text-sm font-extrabold text-white font-mono mt-1 block">{networkSegments[activeSegmentIndex].load}</span>
                  </div>
                  <div className="bg-slate-900/65 border border-slate-900 p-3 rounded-xl">
                    <span className="text-[9px] text-slate-500 uppercase font-mono tracking-wider font-bold block">Rango Latencia</span>
                    <span className="text-sm font-extrabold text-indigo-400 font-mono mt-1 block">{mockPings[mockPings.length - 1]} ms</span>
                  </div>
                </div>

                {/* Line graph replica utilizing simple bars for performance compliance */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                    <span>Muestreo de Ping Latencia (Historial 24h)</span>
                    <span>Análisis Pasivo</span>
                  </div>
                  <div className="bg-slate-900/40 p-4 border border-slate-900 rounded-xl h-24 flex items-end justify-between gap-1.5">
                    {mockPings.map((ping, idx) => (
                      <div key={idx} className="flex-1 flex flex-col items-center">
                        <div 
                          className="w-full bg-indigo-500/30 hover:bg-indigo-500 border border-indigo-500/50 rounded-t-sm transition-all"
                          style={{ height: `${Math.min(100, Math.max(15, (ping / 50) * 85))}px` }}
                        ></div>
                        <span className="text-[8px] font-mono text-slate-600 mt-1">{ping}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bot chat preview replica (AI NOC diagnostics mock) */}
              <div className="bg-indigo-950/20 border border-indigo-900/40 rounded-2xl p-4 sm:p-5 flex items-start space-x-3.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-950 border border-indigo-900 text-indigo-400 flex items-center justify-center shrink-0">
                  <Server className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 font-mono">IA Copiloto NOC</span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    "He diagnosticado el enlace '{networkSegments[activeSegmentIndex].name}'. El ping es estable de {mockPings[mockPings.length - 1]}ms y {networkSegments[activeSegmentIndex].status === 'Optimo' ? 'no reporto pérdidas de paquetes de fibra.' : 'consejo revisar conectores drop en el sector principal Cerro Alto debido a atenuación de red.'}"
                  </p>
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* CONCRETE REAL ISP SAVINGS & MRR CALCULATOR */}
      <section id="roi-calculator" className="py-16 bg-slate-950 border-t border-slate-900 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto space-y-10">
          
          <div className="text-center space-y-3">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 bg-emerald-950 text-emerald-400 border border-emerald-900/50 rounded-full text-[10px] font-mono uppercase tracking-wider">
              <Calculator className="w-3.5 h-3.5 text-emerald-400" />
              <span>Calculadora de Ganancia y Automatización WISP</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">Simula el Crecimiento de tu ISP</h2>
            <p className="text-xs sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Descubre cuánto tiempo y dinero puedes ahorrar al mes automatizando la cobranza recurrente y aplicando suspensiones automáticas por MikroTik API.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800/80 rounded-3xl p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 shadow-2xl">
            
            {/* Input sliders side */}
            <div className="space-y-6">
              <h3 className="text-sm uppercase tracking-wider font-bold text-slate-400 font-mono flex items-center space-x-2">
                <span>Parámetros Operacionales</span>
              </h3>

              {/* Client count slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Abonados Activos (Clientes):</span>
                  <span className="text-sm font-bold text-indigo-400 font-mono">{clientCount} Clientes</span>
                </div>
                <input 
                  type="range" 
                  min="50" 
                  max="5000" 
                  step="25"
                  value={clientCount} 
                  onChange={(e) => setClientCount(Number(e.target.value))}
                  className="w-full accent-indigo-500 bg-slate-950 h-2 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                  <span>50</span>
                  <span>1,000</span>
                  <span>2,500</span>
                  <span>5,000</span>
                </div>
              </div>

              {/* Monthly average subscription plan slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Precio Promedio de Suscripción:</span>
                  <span className="text-sm font-bold text-sky-400 font-mono">${avgPlanPrice} USD/Mes</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="120" 
                  step="5"
                  value={avgPlanPrice} 
                  onChange={(e) => setAvgPlanPrice(Number(e.target.value))}
                  className="w-full accent-sky-500 bg-slate-950 h-2 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                  <span>$10</span>
                  <span>$40</span>
                  <span>$80</span>
                  <span>$120</span>
                </div>
              </div>

              {/* Overheard billing hours spent per week manually */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Horas Semanales en Labores Administrativas Manuales:</span>
                  <span className="text-sm font-bold text-amber-400 font-mono">{currentOverhead} h / Sem</span>
                </div>
                <input 
                  type="range" 
                  min="2" 
                  max="40" 
                  step="1"
                  value={currentOverhead} 
                  onChange={(e) => setCurrentOverhead(Number(e.target.value))}
                  className="w-full tracking-wide accent-amber-500 bg-slate-950 h-2 rounded-lg cursor-pointer"
                />
                <p className="text-[10px] text-slate-500 font-mono mt-1">
                  (Tiempo dedicado a verificar transferencias bancarias, llamar a clientes con saldo moroso, suspender IPs en el router de forma manual, etc.)
                </p>
              </div>
            </div>

            {/* Results Display side */}
            <div className="bg-slate-950 rounded-2xl border border-slate-800 p-6 flex flex-col justify-between">
              <div className="space-y-4">
                <span className="text-[10px] uppercase font-mono tracking-wider font-bold text-slate-500 block">Ingresos Proyectados & Optimizaciones</span>
                
                {/* Metric 1 */}
                <div className="border-b border-slate-900 pb-3">
                  <span className="text-xs text-slate-400">Ingreso Mensual de Suscripción (MRR):</span>
                  <div className="flex items-baseline space-x-1 mt-1">
                    <span className="text-3xl font-black text-white font-mono">${estimatedMRR.toLocaleString()}</span>
                    <span className="text-xs font-mono text-slate-500">USD / Mes</span>
                  </div>
                </div>

                {/* Metric 2 */}
                <div className="border-b border-slate-900 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Tiempo de Administración Recuperado:</span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 border border-emerald-900/60 px-1.5 py-0.5 rounded font-bold">90% Reducción</span>
                  </div>
                  <div className="flex items-baseline space-x-1 mt-1">
                    <span className="text-xl font-black text-emerald-400 font-mono">{automatedBillingSavings} Horas</span>
                    <span className="text-xs font-mono text-slate-500">al mes guardadas</span>
                  </div>
                </div>

                {/* Metric 3 */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Recuperación de Cartera Vencida por Supensión Automatizada:</span>
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950 border border-indigo-900/60 px-1.5 py-0.5 rounded font-bold">Cobranza Activa</span>
                  </div>
                  <div className="flex items-baseline space-x-1 mt-1">
                    <span className="text-xl font-black text-indigo-400 font-mono">+${estimatedCollectionBoost.toLocaleString()}</span>
                    <span className="text-xs font-mono text-slate-500">USD recuperados/mes</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-900">
                <button
                  onClick={onEnterLogin}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-3 rounded-xl transition flex items-center justify-center space-x-1"
                >
                  <span>Iniciar esta configuración en la Consola</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

            </div>

          </div>

        </div>
      </section>

      {/* DETAILED FEATURES INVENTORIZED BENTO GRID */}
      <section id="features" className="py-16 border-t border-slate-900 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto space-y-12">
          
          <div className="text-center space-y-3">
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-500 font-bold block">Consola Multipantalla Modular</span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">Potenciales del Sistema NugaCore</h2>
            <p className="text-xs sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Un ecosistema desarrollado para satisfacer las exigentes demandas operativas del NOC, Administración, Ventas y Campo.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Feature card 1: CRM Clients */}
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
              <div className="w-10 h-10 rounded-xl bg-indigo-950 text-indigo-400 flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <Users className="w-5 h-5 text-indigo-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 font-mono uppercase tracking-wider">CRM de Clientes & Fibra</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Control de prospectos, clientes activos e inactivos. Cada cliente lleva georreferenciación WGS-84 e historial técnico completo.
              </p>
            </div>

            {/* Feature card 2: Router Engine */}
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
              <div className="w-10 h-10 rounded-xl bg-sky-950 text-sky-400 flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <Wifi className="w-5 h-5 text-sky-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 font-mono uppercase tracking-wider">Gestión RouterOS MikroTik</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Sincronización no intrusiva con colas simples (Simple Queues). Suspende, activa o modifica perfiles de ancho de banda al instante.
              </p>
            </div>

            {/* Feature card 3: Automated Suspensión */}
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
              <div className="w-10 h-10 rounded-xl bg-emerald-950 text-emerald-400 flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <DollarSign className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 font-mono uppercase tracking-wider">Facturación y Suspensiones</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Emisión recurrente automatizada de facturas, recibos de caja digital, y suspensiones automáticas por mora de 5 días o suspensión manual flexible.
              </p>
            </div>

            {/* Feature card 4: GIS GPS maps */}
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
              <div className="w-10 h-10 rounded-xl bg-rose-950 text-rose-400 flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <MapPin className="w-5 h-5 text-rose-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 font-mono uppercase tracking-wider font-sans">GIS Georreferenciación Fibra</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Vínculos en mapas cartográficos para identificar hilos, cajas de partición NAP, postes, torres sectoriales y abonados conectados.
              </p>
            </div>

            {/* Feature card 5: Soporte Técnico SLA KANBAN */}
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
              <div className="w-10 h-10 rounded-xl bg-amber-950 text-amber-400 flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <ClipboardCheck className="w-5 h-5 text-amber-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 font-mono uppercase tracking-wider">Checklist Técnico & Firmas</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Tablero Kanban de soporte con SLAs estrictos, hojas técnico-operativas con firmas virtuales de clientes tras cada instalación o reparación exitosa.
              </p>
            </div>

            {/* Feature card 6: AI NOC COPILOT */}
            <div className="bg-slate-900/60 border border-slate-800 p-6 rounded-2xl relative overflow-hidden group">
              <div className="w-10 h-10 rounded-xl bg-purple-950 text-purple-400 flex items-center justify-center mb-4 transition-transform group-hover:scale-110">
                <BrainCircuitIcon className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2 font-mono uppercase tracking-wider">Copiloto IA NOC Inteligente</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Inyección de telemetría a través de la API Gemini de Google para diagnosticar incidentes, generar comandos terminales recomendados, y diagnosticar pings.
              </p>
            </div>

          </div>

        </div>
      </section>

      {/* QUICK INSTANT DEMO HUB & USER LOGIN INTERACTIVELY */}
      <section id="demo-access" className="py-16 bg-slate-900 border-t border-slate-800 px-4 sm:px-6 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-500/10 rounded-full blur-[110px] pointer-events-none"></div>
        <div className="max-w-4xl mx-auto space-y-10 text-center relative z-10">
          
          <div className="space-y-3">
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">Prueba el Poder de NugaCore Ahora</h2>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl mx-auto font-mono">
              Para simplificar tu revisión, puedes elegir cualquiera de los roles operacionales pre-registrado para ingresar directamente y evaluar flujos de red:
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            
            {/* Roles selector button 1 */}
            <button
              onClick={() => handleQuickDemoClick('admin@nugacorp.com')}
              className="bg-slate-950 hover:bg-slate-850 p-5 rounded-2xl border border-slate-850 hover:border-indigo-500/50 transition text-left flex flex-col justify-between h-40 group"
            >
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-400 font-mono">Ing. del NOC</span>
                <h4 className="text-sm font-bold text-white mt-1 group-hover:text-indigo-300">Rodrigo Nuga</h4>
                <p className="text-[11px] text-slate-500 font-mono mt-1">Super Admin</p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-4 border-t border-slate-900 w-full">
                <span>Acceder</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            {/* Roles selector button 2 */}
            <button
              onClick={() => handleQuickDemoClick('cobranza@nugacorp.com')}
              className="bg-slate-950 hover:bg-slate-850 p-5 rounded-2xl border border-slate-850 hover:border-emerald-500/50 transition text-left flex flex-col justify-between h-40 group"
            >
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400 font-mono">Finanzas</span>
                <h4 className="text-sm font-bold text-white mt-1 group-hover:text-emerald-300">Luisa Rojas</h4>
                <p className="text-[11px] text-slate-500 font-mono mt-1">Cobranza</p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-4 border-t border-slate-900 w-full">
                <span>Acceder</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            {/* Roles selector button 3 */}
            <button
              onClick={() => handleQuickDemoClick('tecnico@nugacorp.com')}
              className="bg-slate-950 hover:bg-slate-850 p-5 rounded-2xl border border-slate-850 hover:border-amber-500/50 transition text-left flex flex-col justify-between h-40 group"
            >
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-amber-400 font-mono">Planta Externa</span>
                <h4 className="text-sm font-bold text-white mt-1 group-hover:text-amber-300">Carlos Mendoza</h4>
                <p className="text-[11px] text-slate-500 font-mono mt-1">Técnico Operador</p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-4 border-t border-slate-900 w-full">
                <span>Acceder</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            {/* Roles selector button 4 */}
            <button
              onClick={() => handleQuickDemoClick('soporte@nugacorp.com')}
              className="bg-slate-950 hover:bg-slate-850 p-5 rounded-2xl border border-slate-850 hover:border-blue-500/50 transition text-left flex flex-col justify-between h-40 group"
            >
              <div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-blue-400 font-mono">Atención Soporte</span>
                <h4 className="text-sm font-bold text-white mt-1 group-hover:text-blue-300">Sofía Valenzuela</h4>
                <p className="text-[11px] text-slate-500 font-mono mt-1">Soporte NOC</p>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-4 border-t border-slate-900 w-full">
                <span>Acceder</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

          </div>

          <div className="pt-6">
            <p className="text-xs text-slate-500">
              ¿Quieres configurar tu propia base de datos Supabase? Te informará sobre la detección automática de entornos en <span className="font-mono text-slate-400">.env.example</span>.
            </p>
          </div>

        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 border-t border-slate-900/80 px-4 sm:px-6 py-12 text-slate-500 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center space-x-3 text-slate-400">
            <Cpu className="w-5 h-5 text-indigo-400" />
            <span className="font-extrabold font-mono text-xs">NUGACORE ERP © 2026. Todos los derechos reservados.</span>
          </div>
          <div className="flex items-center space-x-6 font-mono text-[11px]">
            <span>Desarrollado para NugaCorp</span>
            <span>Seguridad AES-256</span>
            <span>Soporte NOC: noc@nugacorp.com</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

// Simple internal icon to avoid missing export issues
function BrainCircuitIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5V3" />
      <path d="M5 12H3" />
      <path d="M21 12h-2" />
      <path d="M12 21v-2" />
      <path d="M18.36 5.64l-1.42 1.42" />
      <path d="M7.05 16.95l-1.42 1.42" />
      <path d="M18.36 18.36l-1.42-1.42" />
      <path d="M7.05 7.05L5.64 5.64" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
