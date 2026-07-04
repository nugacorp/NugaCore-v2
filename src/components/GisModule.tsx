import React, { useState, useEffect, useRef } from 'react';
import { 
  Map as MapIcon, 
  Radio, 
  Sliders, 
  Cpu, 
  Database, 
  AlertTriangle, 
  Activity, 
  Compass
} from 'lucide-react';
import { Tower, Client, NapBox, OnuFTTH, OltFTTH } from '../types';

interface GisModuleProps {
  towers: Tower[];
  clients: Client[];
  naps?: NapBox[];
  onus?: OnuFTTH[];
  olts?: OltFTTH[];
}

export default function GisModule({ 
  towers = [], 
  clients = [], 
  naps = [], 
  onus = [], 
  olts: _olts = [] 
}: GisModuleProps) {
  // Layer visibility toggles
  const [activeNetworkLayer, setActiveNetworkLayer] = useState<'all' | 'wisp' | 'ftth'>('all');
  const [showCoverageRadius, setShowCoverageRadius] = useState(true);
  const [showDropLines, setShowDropLines] = useState(true);
  
  // Interactive Simulation states
  const [dynamicFiberCut, setDynamicFiberCut] = useState<boolean>(false);
  const [highAttenuationSim, setHighAttenuationSim] = useState<boolean>(false);
  
  // Custom Planned Tower controls (maintained from previous version)
  const [showPlannedTower, setShowPlannedTower] = useState(false);
  const [plannedRadiusKm, setPlannedRadiusKm] = useState(8);
  const [plannedLat, setPlannedLat] = useState(19.34);
  const [plannedLng, setPlannedLng] = useState(-99.16);

  // Layout sizing reactive hook
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 680, height: 440 });
  
  // Interactive Tooltip and selection states
  const [activeTooltip, setActiveTooltip] = useState<{ 
    type: 'tower' | 'nap' | 'olt' | 'client'; 
    data: any; 
    x: number; 
    y: number; 
  } | null>(null);
  const [hoveredNapId, setHoveredNapId] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: width || 680, height: height || 440 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Compute bounding geographic coordinates dynamically so NO points go off-screen
  const allLats = [
    19.35, 19.4285, 19.4185, 19.380, // Safe default bounding pins (CDMX)
    ...towers.map(t => t.lat),
    ...clients.map(c => c.lat),
    ...naps.map(n => n.lat)
  ].filter(l => !isNaN(l) && l !== 0);

  const allLngs = [
    -99.17, -99.1655, -99.1555, -99.185,
    ...towers.map(t => t.lng),
    ...clients.map(c => c.lng),
    ...naps.map(n => n.lng)
  ].filter(g => !isNaN(g) && g !== 0);

  // Buffer boundary padding
  const minLat = Math.min(...allLats) - 0.018;
  const maxLat = Math.max(...allLats) + 0.018;
  const minLng = Math.min(...allLngs) - 0.018;
  const maxLng = Math.max(...allLngs) + 0.018;

  // Convert GPS coordinate to responsive SVG X/Y coordinate canvas space
  const convertCoordToXY = (lat: number, lng: number) => {
    const x = ((lng - minLng) / (maxLng - minLng)) * dimensions.width;
    const y = (1.0 - (lat - minLat) / (maxLat - minLat)) * dimensions.height;
    return { x: isNaN(x) ? DimensionsDefaultX : x, y: isNaN(y) ? DimensionsDefaultY : y };
  };

  const DimensionsDefaultX = dimensions.width / 2;
  const DimensionsDefaultY = dimensions.height / 2;

  // Compute core point: OLT Central Cabecera
  // Centered nicely inside the distribution backbone
  const centralOffice = {
    id: 'OLT-CABECERA',
    name: 'Cabecera Central OLT - Centro de Datos CDMX',
    lat: (minLat + maxLat) / 2 + 0.005,
    lng: (minLng + maxLng) / 2 - 0.005,
    model: 'ZTE ZXA10 C600 / Huawei MA5800',
    capacity: '16x PON Ports GPON & XGS-PON'
  };

  const coXY = convertCoordToXY(centralOffice.lat, centralOffice.lng);

  // Primary Splice & Distribution Joint Closure points (splitting Main Fiber into multiple trunk fibers)
  const splices = [
    { id: 'SPLICE-01', name: 'Caja de Empalme Troncal Norte', lat: centralOffice.lat + 0.012, lng: centralOffice.lng + 0.008 },
    { id: 'SPLICE-02', name: 'Caja de Empalme Troncal Sur', lat: centralOffice.lat - 0.010, lng: centralOffice.lng - 0.012 }
  ];

  // Helper calculation: Clients in range for tower planning tool
  const getPlannedClientsInScope = () => {
    const rKm = Number(plannedRadiusKm);
    let count = 0;
    clients.forEach(c => {
      const dLat = (c.lat - plannedLat) * 111;
      const dLng = (c.lng - plannedLng) * 111 * Math.cos(plannedLat * Math.PI / 180);
      const distance = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distance <= rKm) count++;
    });
    return count;
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      
      {/* Dynamic Header with Status indicators */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <MapIcon className="w-6 h-6 text-indigo-400" />
            <span>GIS Co-Map: Fibra Óptica & Coberturas</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Distribución física de Fibra Principal, Líneas Troncales de Distribución, Cajas NAP y Enlaces Inalámbricos.
          </p>
        </div>

        {/* Live Metrics Grid Header */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-left font-mono">
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-indigo-400 font-bold block uppercase leading-none mb-1">Cajas NAP</span>
            <span className="text-sm font-black text-white">{naps.length} <span className="text-[9px] text-slate-400 font-normal">Nodos</span></span>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-emerald-400 font-bold block uppercase leading-none mb-1">Fibra Principal</span>
            <span className="text-sm font-black text-white">48 Hilos <span className="text-[9px] text-slate-400 font-normal">SM</span></span>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-cyan-400 font-bold block uppercase leading-none mb-1">Troncales (ODN)</span>
            <span className="text-sm font-black text-white">12,420m <span className="text-[9px] text-slate-400 font-normal">Ruta</span></span>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-amber-500 font-bold block uppercase leading-none mb-1">Acometidas Activas</span>
            <span className="text-sm font-black text-white">
              {onus.filter(o => o.status === 'online').length} <span className="text-[9px] text-slate-400 font-normal">ONUs</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* Left Control Column (3 columns on Desktop) */}
        <div className="xl:col-span-3 space-y-6 flex flex-col justify-between">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-5">
            <div className="border-b border-slate-900 pb-3">
              <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center space-x-2">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                <span>Controladores de Capas</span>
              </h3>
            </div>

            {/* Filter Layers Buttons */}
            <div className="space-y-2">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">1. Selector de Capa de Red</span>
              <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setActiveNetworkLayer('all')}
                  className={`w-full py-2 px-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                    activeNetworkLayer === 'all'
                      ? 'bg-indigo-600/10 border-indigo-500 text-white font-bold'
                      : 'bg-slate-900/40 border-slate-850 text-slate-400 hover:border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <span>Ver Toda la Planta (WISP + FTTH)</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveNetworkLayer('ftth')}
                  className={`w-full py-2 px-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                    activeNetworkLayer === 'ftth'
                      ? 'bg-emerald-600/10 border-emerald-500 text-white font-bold'
                      : 'bg-slate-900/40 border-slate-850 text-slate-400 hover:border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <span>Ver Distribución Fibra (FTTH)</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveNetworkLayer('wisp')}
                  className={`w-full py-2 px-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                    activeNetworkLayer === 'wisp'
                      ? 'bg-blue-600/10 border-blue-500 text-white font-bold'
                      : 'bg-slate-900/40 border-slate-850 text-slate-400 hover:border-slate-800 hover:text-slate-300'
                  }`}
                >
                  <span>Ver Radioenclaces (WISP)</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                </button>
              </div>
            </div>

            {/* Display Feature Options */}
            <div className="space-y-2 pt-2 border-t border-slate-900 font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">2. Detalles del Trazado</span>
              <div className="space-y-2">
                <label className="flex items-center space-x-2.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCoverageRadius}
                    onChange={(e) => setShowCoverageRadius(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-800 text-indigo-500 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Mostrar cobertura de NAPs/Torres</span>
                </label>
                <label className="flex items-center space-x-2.5 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDropLines}
                    onChange={(e) => setShowDropLines(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-800 text-indigo-500 focus:ring-0 w-3.5 h-3.5"
                  />
                  <span>Hilos de Acometida Subscriber</span>
                </label>
              </div>
            </div>

            {/* Simulated Fiber Failover sandbox */}
            <div className="space-y-3 pt-3 border-t border-slate-900 font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">3. Inyección de Fallas GPON</span>
              
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-850 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[11px] font-medium font-sans">Simular Rotura de Fibra Principal</span>
                  <button
                    onClick={() => {
                      setDynamicFiberCut(!dynamicFiberCut);
                      if (!dynamicFiberCut) setHighAttenuationSim(false);
                    }}
                    className={`px-2 py-1 rounded text-[9px] font-bold border transition ${
                      dynamicFiberCut 
                        ? 'bg-rose-500 border-rose-400 text-white animate-pulse'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-rose-400'
                    }`}
                  >
                    {dynamicFiberCut ? 'ROPTURA ON' : 'FORZAR CORTE'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">
                  Corta la Fibra Principal del anillo central. Las cajas NAP y ONUs aguas abajo pierden su gateway física óptica.
                </p>
              </div>

              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-850 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[11px] font-medium font-sans font-sans">Atenuación Fibra (-38dBm)</span>
                  <button
                    onClick={() => {
                      setHighAttenuationSim(!highAttenuationSim);
                      if (!highAttenuationSim) setDynamicFiberCut(false);
                    }}
                    className={`px-2 py-1 rounded text-[9px] font-bold border transition ${
                      highAttenuationSim 
                        ? 'bg-amber-600 border-amber-500 text-white animate-pulse'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-amber-400'
                    }`}
                  >
                    {highAttenuationSim ? 'ATENUADO' : 'ATENUAR'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">
                  Degrada el enlace óptico debido a empalmes sucios o microcurvaturas severas en el cable de acometida. Las ONUs reportarán alarma RX.
                </p>
              </div>
            </div>

          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[10px] text-slate-500 space-y-1 bg-slate-950/60 leading-normal">
            <div className="flex items-center space-x-1.5 text-slate-300 font-bold mb-1 border-b border-slate-900 pb-1 uppercase">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              <span>Plano Georreferenciado</span>
            </div>
            <p>Esfera de coordenadas: WGS-84</p>
            <p>Cabecera: OLT Centro {centralOffice.lat.toFixed(4)}, {centralOffice.lng.toFixed(4)}</p>
            <p>Hilos de Distribución: 48 Cores ITU-T G.652.D</p>
          </div>
        </div>

        {/* Central Map Workspace (6 columns on Desktop) */}
        <div className="xl:col-span-6 bg-slate-950 p-5 rounded-3xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4 font-sans">
              <span className="text-sm font-bold text-white tracking-wide font-mono flex items-center space-x-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
                <span>Visualizador ODN (Optical Distribution Network)</span>
              </span>
              <div className="hidden sm:flex items-center space-x-2 text-[10px] text-slate-500 font-mono">
                <span>Lat: {minLat.toFixed(3)} a {maxLat.toFixed(3)}</span>
                <span>|</span>
                <span>Lng: {minLng.toFixed(3)} a {maxLng.toFixed(3)}</span>
              </div>
            </div>

            {/* MAP CANVAS (SVG Interactive Interface) */}
            <div 
              ref={containerRef}
              onClick={() => setActiveTooltip(null)}
              className="relative w-full h-[460px] bg-[#070b13] rounded-2xl border border-slate-900 overflow-hidden text-slate-200 cursor-grab active:cursor-grabbing select-none"
            >
              {/* Coordinate Grid Matrix background */}
              <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle, #38bdf8 1px, transparent 1px)", backgroundSize: "24px 24px" }}></div>
              <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "radial-gradient(circle, #6366f1 1px, transparent 1px)", backgroundSize: "96px 96px" }}></div>

              <svg 
                width="100%" 
                height="100%" 
                className="absolute inset-0 z-10"
              >
                {/* DEFINITIONS FOR GRADIENTS & GLOWS */}
                <defs>
                  <radialGradient id="olt-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#818cf8" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
                  </radialGradient>
                  
                  <radialGradient id="nap-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </radialGradient>

                  <linearGradient id="fiber-gradient-main" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="50%" stopColor="#a855f7" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>

                  <linearGradient id="fiber-gradient-cut" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#ef4444" />
                    <stop offset="50%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="#7f1d1d" />
                  </linearGradient>
                </defs>

                {/* LAYER 1: FIBER OPTIC PLANT (FTTH) */}
                {(activeNetworkLayer === 'all' || activeNetworkLayer === 'ftth') && (
                  <>
                    {/* Glow beneath the OLT Central Cabecera */}
                    <circle 
                      cx={coXY.x} 
                      cy={coXY.y} 
                      r="40" 
                      fill="url(#olt-glow)" 
                      className="animate-pulse"
                    />

                    {/* drawing Joint splices coordinates connections */}
                    {splices.map(sp => {
                      const spXY = convertCoordToXY(sp.lat, sp.lng);
                      
                      // FIBRE PRINCIPAL: OLT Central to Joint Closures
                      return (
                        <g key={`fiber-backbone-${sp.id}`}>
                          {/* Inner glowing line */}
                          <line 
                            x1={coXY.x} 
                            y1={coXY.y} 
                            x2={spXY.x} 
                            y2={spXY.y} 
                            stroke={dynamicFiberCut ? 'url(#fiber-gradient-cut)' : 'url(#fiber-gradient-main)'}
                            strokeWidth={dynamicFiberCut ? "2.5" : "4.5"}
                            strokeLinecap="round"
                            opacity={dynamicFiberCut ? "0.4" : "0.85"}
                          />
                          {/* Pulsing light guide overlay inside the fiber */}
                          {!dynamicFiberCut && (
                            <line 
                              x1={coXY.x} 
                              y1={coXY.y} 
                              x2={spXY.x} 
                              y2={spXY.y} 
                              stroke="#67e8f9"
                              strokeWidth="1.5"
                              strokeDasharray="14 11"
                              strokeLinecap="round"
                              className="animate-pulse"
                              opacity="0.8"
                              style={{ animationDuration: '2.5s' }}
                            />
                          )}
                          
                          {/* Splice joint marker point itself */}
                          <circle 
                            cx={spXY.x} 
                            cy={spXY.y} 
                            r="4.5" 
                            className="fill-slate-900 stroke-indigo-400"
                            strokeWidth="2.5"
                          />
                          <text 
                            x={spXY.x + 8} 
                            y={spXY.y + 4} 
                            className="fill-slate-400 font-mono text-[8px] font-semibold"
                          >
                            EMP-SPLICE
                          </text>
                        </g>
                      );
                    })}

                    {/* FIBRAS TRONCALES: Branching feeders from Splices to all active NAP Boxes */}
                    {naps.map((nap, index) => {
                      const napXY = convertCoordToXY(nap.lat, nap.lng);
                      
                      // Assign NAP box to nearest logical splice box for clean trunking curves
                      const nearestSplice = index % 2 === 0 ? splices[0] : splices[1];
                      const spliceXY = convertCoordToXY(nearestSplice.lat, nearestSplice.lng);

                      return (
                        <g key={`feeder-trunk-${nap.id}`}>
                          {/* Trunk line representation */}
                          <path
                            d={`M ${spliceXY.x} ${spliceXY.y} Q ${(spliceXY.x + napXY.x) / 2} ${(spliceXY.y + napXY.y) / 2 + 15}, ${napXY.x} ${napXY.y}`}
                            fill="none"
                            stroke={dynamicFiberCut ? '#ef4444' : highAttenuationSim ? '#d97706' : '#10b981'}
                            strokeWidth="2"
                            strokeDasharray={highAttenuationSim ? "5 3" : undefined}
                            opacity={dynamicFiberCut ? "0.25" : hoveredNapId === nap.id ? "1" : "0.65"}
                          />
                        </g>
                      );
                    })}

                    {/* FIBRA DE ACOMETIDA CLIENT DATA: Drop-cables from NAP boxes directly to customer home terminals */}
                    {showDropLines && onus.map((onu) => {
                      const client = clients.find(c => c.id === onu.clientId);
                      const nap = naps.find(n => n.id === onu.napId);
                      if (!client || !nap) return null;

                      const clientXY = convertCoordToXY(client.lat, client.lng);
                      const napXY = convertCoordToXY(nap.lat, nap.lng);

                      const activeHover = hoveredNapId === nap.id;
                      const isAffectedByFault = dynamicFiberCut || onu.status === 'offline';

                      return (
                        <line 
                          key={`drop-line-${onu.id}`}
                          x1={napXY.x} 
                          y1={napXY.y} 
                          x2={clientXY.x} 
                          y2={clientXY.y} 
                          stroke={isAffectedByFault ? '#f43f5e' : activeHover ? '#38bdf8' : '#0ea5e9'} 
                          strokeWidth={activeHover ? "1.2" : "0.7"} 
                          strokeDasharray="3 3.5" 
                          opacity={activeHover ? "0.9" : "0.4"}
                        />
                      );
                    })}

                    {/* OLT CORE GATEWAY LOGO ON MAP */}
                    <g 
                      className="cursor-pointer group/olt"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTooltip({ type: 'olt', data: centralOffice, x: coXY.x, y: coXY.y });
                      }}
                    >
                      <circle 
                        cx={coXY.x} 
                        cy={coXY.y} 
                        r="9.5" 
                        className="fill-indigo-950 stroke-indigo-400 group-hover/olt:r-11 transition-all duration-200"
                        strokeWidth="3.5"
                      />
                      <rect 
                        x={coXY.x - 4} 
                        y={coXY.y - 4} 
                        width="8" 
                        height="8" 
                        className="fill-cyan-400 animate-pulse" 
                        rx="1.5"
                      />
                      <circle
                        cx={coXY.x}
                        cy={coXY.y}
                        r="18"
                        fill="transparent"
                        className="stroke-indigo-500/20 group-hover/olt:stroke-indigo-400/40"
                        strokeWidth="1"
                      />
                    </g>
                  </>
                )}

                {/* LAYER 2: WIRELESS ANTENNAS CELL TOWERS (WISP) */}
                {(activeNetworkLayer === 'all' || activeNetworkLayer === 'wisp') && (
                  <>
                    {/* Sector coverage cones of active towers */}
                    {towers.map((t) => {
                      if (t.status === 'offline') return null;
                      const { x, y } = convertCoordToXY(t.lat, t.lng);
                      const radiusPx = (t.coverageRadiusKm / 15) * 110;
                      
                      return (
                        <g key={`cone-${t.id}`}>
                          {showCoverageRadius && (
                            <>
                              {/* Radial boundary shadow */}
                              <circle 
                                cx={x} 
                                cy={y} 
                                r={radiusPx} 
                                className={t.status === 'warning' ? "fill-amber-500/5 stroke-amber-500/10" : "fill-blue-600/3 stroke-blue-600/10"}
                                strokeWidth="1"
                              />
                              {/* Coverage sectors arches */}
                              <path
                                d={`M ${x} ${y} L ${x - radiusPx * 0.707} ${y - radiusPx * 0.707} A ${radiusPx} ${radiusPx} 0 0 1 ${x + radiusPx * 0.707} ${y - radiusPx * 0.707} Z`}
                                className={t.status === 'warning' ? "fill-amber-500/10" : "fill-blue-600/5"}
                              />
                            </>
                          )}
                          {/* Backhaul microwave transport paths back to center office */}
                          <line 
                            x1={coXY.x} 
                            y1={coXY.y} 
                            x2={x} 
                            y2={y} 
                            stroke="#3b82f6" 
                            strokeWidth="1.5" 
                            strokeDasharray="5 4" 
                            className="opacity-40"
                          />
                        </g>
                      );
                    })}
                  </>
                )}

                {/* UNIFIED SUBSCRIBERS / PEER CLIENT DOTS */}
                {clients.map((c, i) => {
                  const { x, y } = convertCoordToXY(c.lat, c.lng);
                  const clientOnu = onus.find(o => o.clientId === c.id);
                  const isFtth = c.connectionType === 'FTTH' || !!clientOnu;

                  // Skip client rendering if layer mismatched
                  if (activeNetworkLayer === 'ftth' && !isFtth) return null;
                  if (activeNetworkLayer === 'wisp' && isFtth) return null;

                  let color = "fill-indigo-400";
                  let rVal = "3";
                  
                  if (dynamicFiberCut && isFtth) {
                    color = "fill-rose-500";
                    rVal = "3";
                  } else if (c.status === 'suspended') {
                    color = "fill-rose-500";
                    rVal = "3";
                  } else if (c.status === 'lead') {
                    color = "fill-amber-400";
                    rVal = "3";
                  } else if (isFtth) {
                    color = "fill-sky-400";
                    rVal = "3.5";
                  }

                  return (
                    <g 
                      key={`client-dot-${c.id}-${i}`}
                      className="cursor-pointer group/client"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTooltip({ type: 'client', data: c, x, y });
                      }}
                    >
                      <circle 
                        cx={x} 
                        cy={y} 
                        r={rVal} 
                        className={`${color} hover:r-[5.5px] transition-all duration-150 stroke-slate-950`}
                        strokeWidth="0.5"
                      />
                    </g>
                  );
                })}

                {/* CO-MAP TOWER BASES ACTIVE NODES */}
                {(activeNetworkLayer === 'all' || activeNetworkLayer === 'wisp') && towers.map((t) => {
                  const { x, y } = convertCoordToXY(t.lat, t.lng);
                  let color = "fill-indigo-500";
                  if (t.status === 'warning') color = "fill-amber-500";
                  if (t.status === 'offline') color = "fill-rose-600";
                  
                  return (
                    <g 
                      key={`tower-icon-${t.id}`}
                      className="cursor-pointer group/tower-node"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTooltip({ type: 'tower', data: t, x, y });
                      }}
                    >
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="6" 
                        className={`${color} stroke-slate-950 transition-all duration-200 group-hover/tower-node:r-[8px]`}
                        strokeWidth="2"
                      />
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="14" 
                        fill="transparent"
                        className={`${t.status === 'offline' ? 'stroke-rose-500/0' : 'stroke-blue-400/10'} hover:stroke-white/40 transition-all duration-200`}
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}

                {/* CO-MAP REGISTERED ACTIVE CAJAS NAP */}
                {(activeNetworkLayer === 'all' || activeNetworkLayer === 'ftth') && naps.map((nap) => {
                  const { x, y } = convertCoordToXY(nap.lat, nap.lng);
                  const isCut = dynamicFiberCut;
                  const isLow = highAttenuationSim;
                  const isHovered = hoveredNapId === nap.id;
                  
                  // Color codes for fiber attenuation status
                  let circleColor = "stroke-emerald-400 fill-slate-950";
                  let innerFilledColor = "fill-emerald-500";

                  if (isCut) {
                    circleColor = "stroke-rose-600 fill-slate-950";
                    innerFilledColor = "fill-rose-600";
                  } else if (isLow) {
                    circleColor = "stroke-amber-500 fill-slate-950";
                    innerFilledColor = "fill-amber-500";
                  } else if (nap.fibersFree === 0) {
                    circleColor = "stroke-rose-500 fill-slate-950";
                    innerFilledColor = "fill-rose-500";
                  }

                  return (
                    <g 
                      key={`nap-marker-${nap.id}`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredNapId(nap.id)}
                      onMouseLeave={() => setHoveredNapId(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveTooltip({ type: 'nap', data: nap, x, y });
                      }}
                    >
                      {/* Interactive Coverage Area of individual NAP splitter */}
                      {showCoverageRadius && (
                        <circle 
                          cx={x} 
                          cy={y} 
                          r={(nap.coverageMeters / 300) * 80} 
                          className={`fill-none stroke-[0.8] opacity-20 ${
                            isCut ? 'stroke-rose-600 stroke-dash' : isLow ? 'stroke-amber-400' : 'stroke-emerald-400'
                          }`}
                          strokeDasharray={isCut ? "3 3" : undefined}
                        />
                      )}

                      {/* Small glow ring */}
                      {isHovered && (
                        <circle 
                          cx={x} 
                          cy={y} 
                          r="11" 
                          className="stroke-sky-400/40 fill-none animate-ping"
                          strokeWidth="1"
                        />
                      )}

                      {/* Box Representation */}
                      <rect 
                        x={x - 6} 
                        y={y - 6} 
                        width="12" 
                        height="12" 
                        rx="2.5"
                        className={`${circleColor} transition-all duration-200`}
                        strokeWidth="2.5"
                      />
                      
                      {/* Active fibers indicator dot inside */}
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="2.5"
                        className={`${innerFilledColor} ${isCut ? 'animate-pulse' : ''}`}
                      />

                      {/* Label code tag */}
                      <text 
                        x={x + 9} 
                        y={y + 3} 
                        className="fill-white font-mono text-[8px] font-black tracking-wider shadow-sm select-none"
                      >
                        {nap.id}
                      </text>
                    </g>
                  );
                })}

                {/* 2. Planned Tower Simulator Overlay (Maintained) */}
                {showPlannedTower && (() => {
                  const { x, y } = convertCoordToXY(plannedLat, plannedLng);
                  const radiusPx = (plannedRadiusKm / 15) * 110;
                  return (
                    <g id="planned-tower-overlay-svg">
                      <circle 
                        cx={x} 
                        cy={y} 
                        r={radiusPx} 
                        className="fill-emerald-500/5 stroke-emerald-400/30" 
                        strokeWidth="1.5" 
                        strokeDasharray="3 3"
                      />
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="5" 
                        className="fill-emerald-400 animate-ping"
                      />
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="3" 
                        className="fill-emerald-400"
                      />
                    </g>
                  );
                })()}

              </svg>

              {/* FLOATING RICH DETAILS TOOLTIP DIALOGUE */}
              {activeTooltip && (
                <div 
                  id="map-rich-tooltip"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bg-slate-950/95 border border-slate-800 p-4 rounded-xl shadow-2xl z-30 font-mono text-xs text-slate-350 min-w-[210px] space-y-2.5 backdrop-blur-md"
                  style={{
                    left: Math.max(10, Math.min(dimensions.width - 230, activeTooltip.x - 105)),
                    top: Math.max(10, Math.min(dimensions.height - 230, activeTooltip.y - 200))
                  }}
                >
                  {/* Tooltip Header */}
                  <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                    <span className="font-bold text-white text-xs flex items-center space-x-1">
                      {activeTooltip.type === 'olt' && <Cpu className="w-3.5 h-3.5 text-indigo-400" />}
                      {activeTooltip.type === 'nap' && <Database className="w-3.5 h-3.5 text-emerald-400" />}
                      {activeTooltip.type === 'tower' && <Radio className="w-3.5 h-3.5 text-indigo-400" />}
                      <span>{activeTooltip.type.toUpperCase()}: {activeTooltip.data.id || activeTooltip.data.name}</span>
                    </span>
                    <button 
                      type="button"
                      onClick={() => setActiveTooltip(null)}
                      className="text-slate-500 hover:text-slate-300 transition text-[11px] px-1 font-sans"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Dynamic Fields */}
                  <div className="space-y-1.5 text-[11px]">
                    {activeTooltip.type === 'olt' ? (
                      <>
                        <h5 className="font-bold text-white text-[10px] uppercase text-indigo-400">{activeTooltip.data.name}</h5>
                        <div>Capacidad: <span className="text-slate-300">{activeTooltip.data.capacity}</span></div>
                        <div className="text-emerald-400 font-bold flex items-center space-x-1 pt-1 animate-pulse">
                          <span>🟢 Planta Central Operativa</span>
                        </div>
                      </>
                    ) : activeTooltip.type === 'nap' ? (
                      <>
                        <div className="font-bold text-slate-100 text-[11px] font-sans pb-1 leading-tight">{activeTooltip.data.name}</div>
                        
                        <div className="flex justify-between">
                          <span className="text-slate-500">Puerto Alimentador:</span>
                          <span className="text-slate-300">{activeTooltip.data.ponPort}</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-500">Relación Acople:</span>
                          <span className="text-slate-300">{activeTooltip.data.splitRatio}</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-500">Cobertura Máx:</span>
                          <span className="text-slate-300">{activeTooltip.data.coverageMeters}m</span>
                        </div>

                        <div className="flex justify-between pt-1 border-t border-slate-900 mt-1">
                          <span className="text-slate-500">Capacidad Total:</span>
                          <span className="text-slate-200 font-bold">{activeTooltip.data.fibersTotal} Hilos</span>
                        </div>

                        <div className="flex justify-between">
                          <span className="text-slate-500">Fibras Disponibles:</span>
                          <span className={`font-bold ${
                            dynamicFiberCut ? 'text-rose-500' :
                            activeTooltip.data.fibersFree > 1 ? 'text-emerald-400' : 'text-rose-450'
                          }`}>
                            {dynamicFiberCut ? '0 (FIBRA ROTA)' : `${activeTooltip.data.fibersFree} libres`}
                          </span>
                        </div>

                        {dynamicFiberCut && (
                          <div className="text-[10px] text-rose-400 bg-rose-500/10 border border-rose-500/15 p-1 rounded mt-2.5 text-center leading-normal animate-pulse">
                            ⚠️ SIN ENLACE OPTICO: CORTE FISICO DETECTADO
                          </div>
                        )}
                      </>
                    ) : activeTooltip.type === 'tower' ? (
                      <>
                        <div className="font-bold text-slate-100 uppercase pb-1">{activeTooltip.data.name}</div>
                        <div>Estatus: <span className={`font-bold ${
                          activeTooltip.data.status === 'online' ? 'text-emerald-400' : 'text-rose-500'
                        }`}>{activeTooltip.data.status.toUpperCase()}</span></div>
                        <div>IP AP: <span className="text-slate-300">{activeTooltip.data.ip}</span></div>
                        <div>CPU: <span className="text-slate-300">{activeTooltip.data.cpu}%</span></div>
                        <div>Ping: <span className="text-indigo-400 font-bold">{activeTooltip.data.pingMs}ms</span></div>
                      </>
                    ) : (
                      <>
                        {/* Client details */}
                        <div className="font-bold text-slate-100 truncate pb-0.5">{activeTooltip.data.name}</div>
                        <div>Ciudad: <span className="text-slate-300">{activeTooltip.data.city}</span></div>
                        <div>Servicio: <span className="text-indigo-400 font-bold">{activeTooltip.data.connectionType || 'WISP'}</span></div>
                        <div>IP: <span className="text-slate-300">{activeTooltip.data.ip}</span></div>
                        <div>Estado Cuenta: <span className={`font-bold uppercase ${
                          activeTooltip.data.status === 'active' ? 'text-emerald-400' : 'text-rose-500'
                        }`}>{activeTooltip.data.status}</span></div>
                        
                        {dynamicFiberCut && (activeTooltip.data.connectionType === 'FTTH' || onus.some(o => o.clientId === activeTooltip.data.id)) && (
                          <span className="block text-[9px] text-rose-400 bg-rose-950/10 py-0.5 mt-1 text-center font-bold animate-pulse">
                            🚨 Red Caída (Corte Fibra)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Quick Symbology Key visual overlay */}
              <div className="absolute top-3 left-3 bg-slate-950/95 border border-slate-800 p-3 rounded-xl z-20 text-[9px] space-y-1 md:space-y-1.5 font-mono text-slate-400 backdrop-blur-sm">
                <span className="font-bold text-white block mb-0.5 uppercase tracking-wide">Nomenclatura Óptica</span>
                
                <div className="flex items-center space-x-2">
                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full inline-block"></span>
                  <span>OLT Cabecera (ZTE MA5800)</span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 outline-none rounded bg-[#070b13] border-2 border-emerald-400 inline-block"></span>
                  <span>Caja NAP Activa (Fémina)</span>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-0.5 bg-gradient-to-r from-indigo-500 to-pink-500 inline-block"></span>
                  <span>Fibra Principal (Feeder Backbone)</span>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-0.5 bg-emerald-500 inline-block"></span>
                  <span>Fibras Troncales (Distribution)</span>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-0.5 border-t border-dashed border-sky-400 inline-block"></span>
                  <span>Drop de Abonado (Last-Mile)</span>
                </div>

                {dynamicFiberCut && (
                  <div className="text-[8px] bg-rose-950 text-rose-400 px-1 py-0.5 rounded font-bold animate-pulse uppercase text-center">
                    🚨 Corte Troncal Activo
                  </div>
                )}
              </div>

              {/* Floating notification bar inside map when simulator events run */}
              {dynamicFiberCut && (
                <div className="absolute top-3 right-3 bg-rose-950/95 border border-rose-500/50 p-2 rounded-xl z-20 text-[10px] font-mono text-rose-200 animate-bounce flex items-center space-x-1.5 backdrop-blur-sm">
                  <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />
                  <span>Corte detectado en Anillo Principal v1</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Co-Map Factibility & Planning Widgets (3 columns on Desktop) */}
        <div className="xl:col-span-3 space-y-6">
          
          {/* FTTH Network Diagnostic Monitor */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Diagnóstico ODN Pasivo</span>
            </h3>

            <p className="text-[11px] text-slate-400 leading-normal font-sans">
              Analiza en tiempo real las atenuaciones de la red óptica pasiva (ODN) y pérdidas por dispersión cromática.
            </p>

            <div className="space-y-3 font-mono text-xs">
              
              {/* OLT Port Splitter Util */}
              <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-900 space-y-2">
                <div className="flex justify-between ">
                  <span className="text-slate-400">Canal Alimentador:</span>
                  <span className="text-white font-bold">16x PONs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Splitters:</span>
                  <span className="text-white">splt-01, splt-02</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">Nivel Potencia OLT TX:</span>
                  <span className="text-emerald-400 font-black">+3.20 dBm</span>
                </div>
                <div className="flex justify-between border-t border-slate-950 pt-1">
                  <span className="text-slate-400 font-sans">RX Promedio CPE ONU:</span>
                  <span className={`font-black ${
                    dynamicFiberCut ? 'text-rose-500 font-black animate-pulse' :
                    highAttenuationSim ? 'text-amber-500' : 'text-emerald-400'
                  }`}>
                    {dynamicFiberCut ? 'Loss of Signal' : highAttenuationSim ? '-38.42 dBm' : '-19.24 dBm'}
                  </span>
                </div>
              </div>

              {/* Optical Budget details */}
              <div className="space-y-2 pt-1">
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Presupuesto de Potencia</span>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className="bg-slate-900/20 border border-slate-900 rounded p-2 text-center">
                    <span className="text-slate-500 block">Atenuación Fibra</span>
                    <strong className="text-white">{dynamicFiberCut ? '∞ dB' : '0.24 dB/Km'}</strong>
                  </div>
                  <div className="bg-slate-900/20 border border-slate-900 rounded p-2 text-center">
                    <span className="text-slate-500 block">Pérdida Splitting</span>
                    <strong className="text-white">{highAttenuationSim ? '18.4 dB' : '10.5 dB (1:8)'}</strong>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Core Wireless Planning (Existing widget layout, maintained without loss) */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span>Simulador de Expansión WISP</span>
            </h3>
            
            <p className="text-[11px] text-slate-400 leading-normal font-sans">
              Simula la cobertura de propagación de ondas de radio de una nueva microfrecuencia AP en la zona central de CDMX.
            </p>

            <div className="space-y-4 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span>¿Habilitar nueva torre?</span>
                <button
                  type="button"
                  onClick={() => setShowPlannedTower(!showPlannedTower)}
                  className={`px-2.5 py-1.5 rounded-lg text-[9px] font-bold border transition duration-200 ${
                    showPlannedTower
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-850 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {showPlannedTower ? 'APAGAR OVERLAY' : 'ENCENDER OVERLAY'}
                </button>
              </div>

              {showPlannedTower && (
                <div className="space-y-3.5 border-t border-slate-900 pt-3">
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[9px]">Radio</span>
                      <span className="text-indigo-400 font-bold">{plannedRadiusKm} Km</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="15"
                      step="1"
                      value={plannedRadiusKm}
                      onChange={(e) => setPlannedRadiusKm(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-slate-500 uppercase text-[8px] block">Ajuste Latitud</span>
                      <input
                        type="number"
                        step="0.005"
                        min="19.2"
                        max="19.5"
                        value={plannedLat}
                        onChange={(e) => setPlannedLat(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-850 rounded p-1.5 w-full text-[10px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-slate-500 uppercase text-[8px] block">Ajuste Longitud</span>
                      <input
                        type="number"
                        step="0.005"
                        min="-99.3"
                        max="-99.0"
                        value={plannedLng}
                        onChange={(e) => setPlannedLng(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-850 rounded p-1.5 w-full text-[10px]"
                      />
                    </div>
                  </div>

                  <div className="bg-indigo-950/20 border border-indigo-900/30 p-3 rounded-xl text-center">
                    <span className="text-slate-500 uppercase text-[9px] block mb-0.5">Suscripciones Potenciales</span>
                    <span className="text-2xl font-black text-indigo-400 font-mono">{getPlannedClientsInScope()}</span>
                    <span className="text-[9px] text-slate-500 block leading-tight mt-1">Garantiza visibilidad técnica de línea de vista directa (LOS).</span>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
