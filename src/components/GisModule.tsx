import React, { useMemo, useState } from 'react';
import {
  Map as MapIcon,
  Radio,
  Sliders,
  Activity,
  Compass,
} from 'lucide-react';
import { Tower, Client, NapBox, OnuFTTH, OltFTTH } from '../types';
import GisLeafletMap from './gis/GisLeafletMap';

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
  olts = [],
}: GisModuleProps) {
  const [activeNetworkLayer, setActiveNetworkLayer] = useState<'all' | 'wisp' | 'ftth'>('all');
  const [showCoverageRadius, setShowCoverageRadius] = useState(true);
  const [showDropLines, setShowDropLines] = useState(true);
  const [dynamicFiberCut, setDynamicFiberCut] = useState(false);
  const [highAttenuationSim, setHighAttenuationSim] = useState(false);
  const [showPlannedTower, setShowPlannedTower] = useState(false);
  const [plannedRadiusKm, setPlannedRadiusKm] = useState(8);
  const [plannedLat, setPlannedLat] = useState(19.34);
  const [plannedLng, setPlannedLng] = useState(-99.16);

  const { centralOffice, splices, bboxLabel } = useMemo(() => {
    const lats = [
      ...towers.map((t) => t.lat),
      ...clients.map((c) => c.lat),
      ...naps.map((n) => n.lat),
    ].filter((l) => Number.isFinite(l) && l !== 0);
    const lngs = [
      ...towers.map((t) => t.lng),
      ...clients.map((c) => c.lng),
      ...naps.map((n) => n.lng),
    ].filter((g) => Number.isFinite(g) && g !== 0);

    const minLat = (lats.length ? Math.min(...lats) : 19.35) - 0.01;
    const maxLat = (lats.length ? Math.max(...lats) : 19.45) + 0.01;
    const minLng = (lngs.length ? Math.min(...lngs) : -99.2) - 0.01;
    const maxLng = (lngs.length ? Math.max(...lngs) : -99.1) + 0.01;

    const realOlt = olts[0];
    const centralOffice = {
      id: realOlt?.id || 'OLT-CABECERA',
      name: realOlt?.name || 'Cabecera Central OLT',
      lat: (minLat + maxLat) / 2 + 0.004,
      lng: (minLng + maxLng) / 2 - 0.004,
      capacity: realOlt
        ? `${realOlt.brand} · ${realOlt.portsCount} PON · ${realOlt.onusConnected}/${realOlt.onusLimit} ONU`
        : '16x PON GPON / XGS-PON',
    };

    const splices = [
      {
        id: 'SPLICE-01',
        name: 'Caja de empalme troncal A',
        lat: centralOffice.lat + 0.008,
        lng: centralOffice.lng + 0.006,
      },
      {
        id: 'SPLICE-02',
        name: 'Caja de empalme troncal B',
        lat: centralOffice.lat - 0.007,
        lng: centralOffice.lng - 0.008,
      },
    ];

    return {
      centralOffice,
      splices,
      bboxLabel: `Lat ${minLat.toFixed(3)}…${maxLat.toFixed(3)} · Lng ${minLng.toFixed(3)}…${maxLng.toFixed(3)}`,
    };
  }, [towers, clients, naps, olts]);

  const getPlannedClientsInScope = () => {
    const rKm = Number(plannedRadiusKm);
    let count = 0;
    clients.forEach((c) => {
      const dLat = (c.lat - plannedLat) * 111;
      const dLng = (c.lng - plannedLng) * 111 * Math.cos((plannedLat * Math.PI) / 180);
      const distance = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distance <= rKm) count += 1;
    });
    return count;
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <MapIcon className="w-6 h-6 text-indigo-400" />
            <span>GIS Co-Map: Fibra Óptica & Coberturas</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Mapa geográfico fluido (OSM) · fibra, NAPs, torres y abonados.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-left font-mono">
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-indigo-400 font-bold block uppercase leading-none mb-1">Cajas NAP</span>
            <span className="text-sm font-black text-white">
              {naps.length} <span className="text-[9px] text-slate-400 font-normal">Nodos</span>
            </span>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-emerald-400 font-bold block uppercase leading-none mb-1">Torres</span>
            <span className="text-sm font-black text-white">
              {towers.length} <span className="text-[9px] text-slate-400 font-normal">WISP</span>
            </span>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-cyan-400 font-bold block uppercase leading-none mb-1">Clientes mapa</span>
            <span className="text-sm font-black text-white">
              {clients.filter((c) => c.lat && c.lng).length}{' '}
              <span className="text-[9px] text-slate-400 font-normal">GPS</span>
            </span>
          </div>
          <div className="bg-slate-950/80 border border-slate-800/60 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-amber-500 font-bold block uppercase leading-none mb-1">ONUs online</span>
            <span className="text-sm font-black text-white">
              {onus.filter((o) => o.status === 'online').length}{' '}
              <span className="text-[9px] text-slate-400 font-normal">activas</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left controls — mismos paneles */}
        <div className="xl:col-span-3 space-y-6 flex flex-col justify-between">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-5">
            <div className="border-b border-slate-900 pb-3">
              <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center space-x-2">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                <span>Controladores de Capas</span>
              </h3>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">1. Selector de Capa de Red</span>
              <div className="grid grid-cols-1 gap-1.5 text-xs font-mono">
                {(
                  [
                    ['all', 'Ver Toda la Planta (WISP + FTTH)', 'indigo'],
                    ['ftth', 'Ver Distribución Fibra (FTTH)', 'emerald'],
                    ['wisp', 'Ver Radioenlaces (WISP)', 'blue'],
                  ] as const
                ).map(([id, label, tone]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveNetworkLayer(id)}
                    className={`w-full py-2 px-3 rounded-lg border text-left transition-all flex items-center justify-between ${
                      activeNetworkLayer === id
                        ? tone === 'emerald'
                          ? 'bg-emerald-600/10 border-emerald-500 text-white font-bold'
                          : tone === 'blue'
                            ? 'bg-blue-600/10 border-blue-500 text-white font-bold'
                            : 'bg-indigo-600/10 border-indigo-500 text-white font-bold'
                        : 'bg-slate-900/40 border-slate-850 text-slate-400 hover:border-slate-800 hover:text-slate-300'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        tone === 'emerald' ? 'bg-emerald-400' : tone === 'blue' ? 'bg-blue-400' : 'bg-indigo-400'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

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

            <div className="space-y-3 pt-3 border-t border-slate-900 font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">3. Inyección de Fallas GPON</span>
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-850 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[11px] font-medium font-sans">Simular Rotura de Fibra Principal</span>
                  <button
                    type="button"
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
                  Corta el backbone. Las NAP/ONU aguas abajo se marcan sin enlace.
                </p>
              </div>
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-850 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[11px] font-medium font-sans">Atenuación Fibra (-38dBm)</span>
                  <button
                    type="button"
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
                  Degrada el enlace óptico (empalmes / microcurvaturas). Las ONU reportan alarma RX.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[10px] text-slate-500 space-y-1 leading-normal">
            <div className="flex items-center space-x-1.5 text-slate-300 font-bold mb-1 border-b border-slate-900 pb-1 uppercase">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              <span>Plano Georreferenciado</span>
            </div>
            <p>Esfera: WGS-84 · tiles OSM/CARTO</p>
            <p>
              Cabecera: {centralOffice.lat.toFixed(4)}, {centralOffice.lng.toFixed(4)}
            </p>
            <p>Pan / zoom con rueda y arrastre (estilo UISP).</p>
          </div>
        </div>

        {/* Centro: mapa Leaflet */}
        <div className="xl:col-span-6 bg-slate-950 p-5 rounded-3xl border border-slate-800 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
            <span className="text-sm font-bold text-white tracking-wide font-mono flex items-center space-x-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
              <span>Visualizador ODN · mapa vivo</span>
            </span>
            <div className="hidden sm:block text-[10px] text-slate-500 font-mono">{bboxLabel}</div>
          </div>

          <GisLeafletMap
            towers={towers}
            clients={clients}
            naps={naps}
            onus={onus}
            activeNetworkLayer={activeNetworkLayer}
            showCoverageRadius={showCoverageRadius}
            showDropLines={showDropLines}
            dynamicFiberCut={dynamicFiberCut}
            highAttenuationSim={highAttenuationSim}
            showPlannedTower={showPlannedTower}
            plannedLat={plannedLat}
            plannedLng={plannedLng}
            plannedRadiusKm={plannedRadiusKm}
            centralOffice={centralOffice}
            splices={splices}
          />
        </div>

        {/* Right diagnostics — mismos widgets */}
        <div className="xl:col-span-3 space-y-6">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>Diagnóstico ODN Pasivo</span>
            </h3>
            <p className="text-[11px] text-slate-400 leading-normal font-sans">
              Atenuaciones ODN y estado óptico (simulación + lectura de capas del mapa).
            </p>
            <div className="space-y-3 font-mono text-xs">
              <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-900 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Canal Alimentador:</span>
                  <span className="text-white font-bold">16x PONs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">NAPs en mapa:</span>
                  <span className="text-white">{naps.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 font-sans">Nivel Potencia OLT TX:</span>
                  <span className="text-emerald-400 font-black">+3.20 dBm</span>
                </div>
                <div className="flex justify-between border-t border-slate-950 pt-1">
                  <span className="text-slate-400 font-sans">RX Promedio CPE ONU:</span>
                  <span
                    className={`font-black ${
                      dynamicFiberCut
                        ? 'text-rose-500 animate-pulse'
                        : highAttenuationSim
                          ? 'text-amber-500'
                          : 'text-emerald-400'
                    }`}
                  >
                    {dynamicFiberCut ? 'Loss of Signal' : highAttenuationSim ? '-38.42 dBm' : '-19.24 dBm'}
                  </span>
                </div>
              </div>
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

          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center space-x-2 border-b border-slate-900 pb-3">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <span>Simulador de Expansión WISP</span>
            </h3>
            <p className="text-[11px] text-slate-400 leading-normal font-sans">
              Overlay de cobertura de una torre planificada sobre el mapa real.
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
                      <span className="text-slate-500 uppercase text-[8px] block">Latitud</span>
                      <input
                        type="number"
                        step="0.005"
                        value={plannedLat}
                        onChange={(e) => setPlannedLat(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-850 rounded p-1.5 w-full text-[10px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <span className="text-slate-500 uppercase text-[8px] block">Longitud</span>
                      <input
                        type="number"
                        step="0.005"
                        value={plannedLng}
                        onChange={(e) => setPlannedLng(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-850 rounded p-1.5 w-full text-[10px]"
                      />
                    </div>
                  </div>
                  <div className="bg-indigo-950/20 border border-indigo-900/30 p-3 rounded-xl text-center">
                    <span className="text-slate-500 uppercase text-[9px] block mb-0.5">Suscripciones potenciales</span>
                    <span className="text-2xl font-black text-indigo-400 font-mono">{getPlannedClientsInScope()}</span>
                    <span className="text-[9px] text-slate-500 block leading-tight mt-1">
                      Clientes GPS dentro del radio planificado.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[10px] text-slate-500 flex items-start gap-2">
            <Radio className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
            <p>
              Tip: rueda = zoom, arrastre = pan, clic en marcador = ficha. Capas a la izquierda.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
