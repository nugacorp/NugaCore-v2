import React, { useState, useEffect, useRef } from 'react';
import { Map, Radio, ZoomIn, ZoomOut, Plus, Sliders, Layers, RefreshCw } from 'lucide-react';
import { Tower, Client } from '../types';

interface GisModuleProps {
  towers: Tower[];
  clients: Client[];
}

export default function GisModule({ towers, clients }: GisModuleProps) {
  // Simulator Controls
  const [showPlannedTower, setShowPlannedTower] = useState(false);
  const [plannedRadiusKm, setPlannedRadiusKm] = useState(8);
  const [plannedLat, setPlannedLat] = useState(19.35);
  const [plannedLng, setPlannedLng] = useState(-99.155);

  // Layout sizing
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [activeTooltip, setActiveTooltip] = useState<{ tower: Tower; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: width || 600, height: height || 400 });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Map Coordinates convert functions
  // Central Coordinate for CDMX center: lat = 19.38, lng = -99.17
  const convertCoordToXY = (lat: number, lng: number) => {
    // scale coordinates to dimension boundaries
    const latCenter = 19.37;
    const lngCenter = -99.17;
    const latSpan = 0.18; // lat span bounds
    const lngSpan = 0.18;

    const x = ((lng - lngCenter) / lngSpan + 0.5) * dimensions.width;
    // Map coords invert: higher lat is higher Y in math, but lower Y in SVG pixels
    const y = (0.5 - (lat - latCenter) / latSpan) * dimensions.height;
    return { x, y };
  };

  const getPlannedClientsInScope = () => {
    const rKm = Number(plannedRadiusKm);
    let count = 0;
    clients.forEach(c => {
      // rough distance latlng calculation (1 deg lat ~ 111km)
      const dLat = (c.lat - plannedLat) * 111;
      const dLng = (c.lng - plannedLng) * 111 * Math.cos(plannedLat * Math.PI / 180);
      const distance = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distance <= rKm) count++;
    });
    return count;
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      {/* Header Bento block */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Map className="w-6 h-6 text-indigo-400" />
            <span>GIS Co-Map: Coberturas & Factibilidad</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Mapeo interactivo georreferenciado de sectores de transmisión, líneas de acometida FTTH y terminales NAP.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive SVG Map (8 columns) */}
        <div className="lg:col-span-8 bg-slate-950 p-6 rounded-3xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
              <span className="text-sm font-bold text-white tracking-wide font-mono">Mapa Vectorial WISP CDMX & Acapulco</span>
              <div className="flex items-center space-x-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                <span className="text-[10px] text-slate-500 font-mono">Nudos Totales: {towers.length + clients.length}</span>
              </div>
            </div>

            {/* SVG Interactive Area */}
            <div 
              ref={containerRef}
              onClick={() => setActiveTooltip(null)}
              className="relative w-full h-[380px] bg-slate-900/40 rounded-2xl border border-slate-900 overflow-hidden text-slate-200"
            >
              {/* Radial background representing coordinate grid */}
              <div className="absolute inset-0 opacity-15" style={{ backgroundImage: "radial-gradient(circle, #4f46e5 1px, transparent 1px)", backgroundSize: "30px 30px" }}></div>

              <svg 
                width="100%" 
                height="100%" 
                className="absolute inset-0 z-10"
              >
                {/* 1. Sector coverage colored circles/cones of active towers */}
                {towers.map((t) => {
                  if (t.status === 'offline') return null;
                  const { x, y } = convertCoordToXY(t.lat, t.lng);
                  // scale Km coverage to pixels
                  const radiusPx = (t.coverageRadiusKm / 15) * 110;
                  return (
                    <g key={`cone-${t.id}`}>
                      {/* Outer shadow radius */}
                      <circle 
                        cx={x} 
                        cy={y} 
                        r={radiusPx} 
                        className={t.status === 'warning' ? "fill-amber-500/5 stroke-amber-500/10" : "fill-indigo-600/5 stroke-indigo-600/10"}
                        strokeWidth="1.5"
                      />
                      {/* Sector angle arcs representing sectors */}
                      <path
                        d={`M ${x} ${y} L ${x - radiusPx * 0.707} ${y - radiusPx * 0.707} A ${radiusPx} ${radiusPx} 0 0 1 ${x + radiusPx * 0.707} ${y - radiusPx * 0.707} Z`}
                        className={t.status === 'warning' ? "fill-amber-500/10" : "fill-indigo-600/10"}
                      />
                      {/* Fiber transport path simulation from server to towers */}
                      <line 
                        x1={dimensions.width / 2} 
                        y1={dimensions.height / 2} 
                        x2={x} 
                        y2={y} 
                        stroke="#4f46e5" 
                        strokeWidth="1.5" 
                        strokeDasharray="4 2" 
                        className="opacity-50 animate-pulse"
                      />
                    </g>
                  );
                })}

                {/* 2. Planned Tower Simulator Overlay */}
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

                {/* 3. Draw Client dots */}
                {clients.map((c, i) => {
                  const { x, y } = convertCoordToXY(c.lat, c.lng);
                  let color = "fill-indigo-400";
                  if (c.status === 'suspended') color = "fill-rose-500";
                  if (c.status === 'lead') color = "fill-amber-400";
                  return (
                    <g key={`client-dot-${c.id}-${i}`}>
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="3.5" 
                        className={`${color} hover:r-5 transition cursor-pointer`}
                      />
                    </g>
                  );
                })}

                {/* 4. Draw Active Towers markers */}
                {towers.map((t) => {
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
                        setActiveTooltip({ tower: t, x, y });
                      }}
                    >
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="6" 
                        className={`${color} stroke-slate-950 transition-all duration-200 group-hover/tower-node:r-[7.5px]`}
                        strokeWidth="2"
                      />
                      <circle 
                        cx={x} 
                        cy={y} 
                        r="14" 
                        fill="transparent"
                        className={`${t.status === 'offline' ? 'stroke-rose-500/0' : 'stroke-white/10'} hover:stroke-white/40 transition-all duration-200`}
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Absolutely positioned tower custom pop-over tooltip */}
              {activeTooltip && (
                <div 
                  id={`tower-tooltip-${activeTooltip.tower.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bg-slate-950/95 border border-slate-800 p-4 rounded-2xl shadow-2xl z-30 font-mono text-xs text-slate-300 w-56 space-y-2.5 backdrop-blur-sm"
                  style={{
                    left: Math.max(10, Math.min(dimensions.width - 240, activeTooltip.x - 112)),
                    top: Math.max(10, Math.min(dimensions.height - 210, activeTooltip.y - 185))
                  }}
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-white text-sm truncate pr-2">{activeTooltip.tower.name}</span>
                    <button 
                      type="button"
                      onClick={() => setActiveTooltip(null)}
                      className="text-slate-500 hover:text-slate-300 transition text-[13px] px-1 font-sans"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[9px] font-bold">Estado:</span>
                      <span className={`font-bold ${
                        activeTooltip.tower.status === 'online' ? 'text-emerald-400' :
                        activeTooltip.tower.status === 'warning' ? 'text-amber-400' : 'text-rose-500'
                      }`}>{activeTooltip.tower.status.toUpperCase()}</span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[9px] font-bold">IP AP:</span>
                      <span className="text-slate-300">{activeTooltip.tower.ip}</span>
                    </div>

                    <div className="space-y-1 pt-0.5">
                      <div className="flex justify-between">
                        <span className="text-slate-500 uppercase text-[9px] font-bold">Carga CPU:</span>
                        <span className="text-slate-300">{activeTooltip.tower.cpu}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            activeTooltip.tower.cpu > 75 ? 'bg-rose-500' :
                            activeTooltip.tower.cpu > 45 ? 'bg-amber-500' : 'bg-indigo-500'
                          }`} 
                          style={{ width: `${activeTooltip.tower.cpu}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="space-y-1 pt-0.5">
                      <div className="flex justify-between">
                        <span className="text-slate-500 uppercase text-[9px] font-bold">Memoria RAM:</span>
                        <span className="text-slate-300">{activeTooltip.tower.ram}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        <div 
                          className="h-full bg-emerald-500 transition-all duration-300" 
                          style={{ width: `${activeTooltip.tower.ram}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[9px] font-bold">Temp:</span>
                      <span className="text-slate-300">{activeTooltip.tower.tempCelsius}°C</span>
                    </div>

                    <div className="flex justify-between border-t border-slate-900 pt-2 mt-1">
                      <span className="text-slate-500 uppercase text-[9px] font-bold">Tiempo Activo:</span>
                      <span className="text-indigo-300 font-bold font-mono">{activeTooltip.tower.uptime}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Map floating control legends */}
              <div className="absolute bottom-3 left-3 bg-slate-950/90 border border-slate-800 p-3 rounded-xl z-20 text-[10px] space-y-1.5 font-mono text-slate-400">
                <span className="font-bold text-white block">Simbología GIS</span>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block"></span>
                  <span>Torre AP Activa</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600 inline-block"></span>
                  <span>Torre AP Caída</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 inline-block"></span>
                  <span>Cliente Suscriptor</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                  <span>PPPoE Suspendido</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>
                  <span>Prospecto Comercial</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Planning Simulator Widget (4 columns) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 space-y-5">
            <h3 className="text-base font-bold text-white flex items-center space-x-2 font-mono">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <span>Planificador Coberturas</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Simula la factibilidad técnica instalando una torre de cobertura experimental (Sectores AP Mimosa / AP Ubiquiti) para ver cuántos clientes o prospectos impactas.
            </p>

            <div className="space-y-4 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span>¿Habilitar nueva torre?</span>
                <button
                  type="button"
                  onClick={() => setShowPlannedTower(!showPlannedTower)}
                  id="toggle-planned-tower-overlay"
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition duration-200 ${
                    showPlannedTower
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {showPlannedTower ? 'DESACTIVAR OVERLAY' : 'ACTIVAR OVERLAY'}
                </button>
              </div>

              {showPlannedTower && (
                <div className="space-y-4 border-t border-slate-900 pt-3">
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500 uppercase text-[9px]">Radio Cobertura</span>
                      <span className="text-emerald-400 font-bold">{plannedRadiusKm} Km</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="15"
                      step="1"
                      value={plannedRadiusKm}
                      onChange={(e) => setPlannedRadiusKm(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <span className="text-slate-500 uppercase text-[9px] block">Ajuste Latitud</span>
                      <input
                        type="number"
                        step="0.005"
                        min="19.2"
                        max="19.5"
                        value={plannedLat}
                        onChange={(e) => setPlannedLat(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-850 rounded-lg p-1.5 w-full text-[11px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-slate-500 uppercase text-[9px] block">Ajuste Longitud</span>
                      <input
                        type="number"
                        step="0.005"
                        min="-99.3"
                        max="-99.0"
                        value={plannedLng}
                        onChange={(e) => setPlannedLng(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-850 rounded-lg p-1.5 w-full text-[11px]"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-900 p-4 rounded-xl border border-slate-850 text-center">
                    <span className="text-slate-500 uppercase text-[9px] block mb-1 font-bold">Suscriptores Potenciales Encapsulados</span>
                    <span className="text-3xl font-extrabold text-emerald-400 font-mono">{getPlannedClientsInScope()}</span>
                    <span className="text-[10px] text-slate-500 block mt-1 leading-snug">Factibilidad aprobada bajo el nuevo arco radioeléctrico.</span>
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
