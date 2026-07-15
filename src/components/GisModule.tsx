import React, { useMemo, useState } from 'react';
import { Map as MapIcon, Sliders, Activity, Compass, Cable } from 'lucide-react';
import { Client, NapBox, OnuFTTH, OltFTTH } from '../types';
import GisLeafletMap from './gis/GisLeafletMap';

interface GisModuleProps {
  towers?: unknown[];
  clients: Client[];
  naps?: NapBox[];
  onus?: OnuFTTH[];
  olts?: OltFTTH[];
}

/** Mapa de Red = planta FTTH / GPON (fibra). WISP vive en Torres y Sitios. */
export default function GisModule({
  clients = [],
  naps = [],
  onus = [],
  olts = [],
}: GisModuleProps) {
  const [showNapCoverage, setShowNapCoverage] = useState(true);
  const [showDropLines, setShowDropLines] = useState(true);
  const [dynamicFiberCut, setDynamicFiberCut] = useState(false);
  const [highAttenuationSim, setHighAttenuationSim] = useState(false);

  const ftthClients = useMemo(
    () =>
      clients.filter(
        (c) => c.connectionType === 'FTTH' || onus.some((o) => o.clientId === c.id),
      ),
    [clients, onus],
  );

  const { centralOffice, splices, bboxLabel } = useMemo(() => {
    const lats = [
      ...ftthClients.map((c) => c.lat),
      ...naps.map((n) => n.lat),
    ].filter((l) => Number.isFinite(l) && l !== 0);
    const lngs = [
      ...ftthClients.map((c) => c.lng),
      ...naps.map((n) => n.lng),
    ].filter((g) => Number.isFinite(g) && g !== 0);

    const minLat = (lats.length ? Math.min(...lats) : 19.35) - 0.01;
    const maxLat = (lats.length ? Math.max(...lats) : 19.45) + 0.01;
    const minLng = (lngs.length ? Math.min(...lngs) : -99.2) - 0.01;
    const maxLng = (lngs.length ? Math.max(...lngs) : -99.1) + 0.01;

    const realOlt = olts[0];
    const centralOffice = {
      id: realOlt?.id || 'OLT-CABECERA',
      name: realOlt?.name || 'Cabecera OLT GPON',
      lat: (minLat + maxLat) / 2 + 0.004,
      lng: (minLng + maxLng) / 2 - 0.004,
      capacity: realOlt
        ? `${realOlt.brand} · ${realOlt.portsCount} PON · ${realOlt.onusConnected}/${realOlt.onusLimit} ONU`
        : 'GPON / XGS-PON',
    };

    const splices = [
      {
        id: 'SPLICE-01',
        name: 'Empalme feeder A',
        lat: centralOffice.lat + 0.008,
        lng: centralOffice.lng + 0.006,
      },
      {
        id: 'SPLICE-02',
        name: 'Empalme feeder B',
        lat: centralOffice.lat - 0.007,
        lng: centralOffice.lng - 0.008,
      },
    ];

    return {
      centralOffice,
      splices,
      bboxLabel: `Lat ${minLat.toFixed(3)}…${maxLat.toFixed(3)} · Lng ${minLng.toFixed(3)}…${maxLng.toFixed(3)}`,
    };
  }, [ftthClients, naps, olts]);

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Cable className="w-6 h-6 text-emerald-400" />
            <span>Mapa FTTH · Planta de Fibra</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            OLT → feeder → empalmes → NAP → drop ONU. Torres WISP están en{' '}
            <span className="text-sky-300">Torres y Sitios</span>.
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-left font-mono">
          <div className="bg-slate-950/80 border border-emerald-900/40 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-emerald-400 font-bold block uppercase mb-1">NAPs</span>
            <span className="text-sm font-black text-white">{naps.length}</span>
          </div>
          <div className="bg-slate-950/80 border border-violet-900/40 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-violet-400 font-bold block uppercase mb-1">OLTs</span>
            <span className="text-sm font-black text-white">{Math.max(olts.length, 1)}</span>
          </div>
          <div className="bg-slate-950/80 border border-sky-900/40 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-sky-400 font-bold block uppercase mb-1">Abonados FTTH</span>
            <span className="text-sm font-black text-white">{ftthClients.length}</span>
          </div>
          <div className="bg-slate-950/80 border border-amber-900/40 px-3.5 py-1.5 rounded-xl">
            <span className="text-[9px] text-amber-400 font-bold block uppercase mb-1">ONUs online</span>
            <span className="text-sm font-black text-white">
              {onus.filter((o) => o.status === 'online').length}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-3 space-y-6 flex flex-col justify-between">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-5">
            <div className="border-b border-slate-900 pb-3">
              <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                Capas ópticas
              </h3>
            </div>
            <div className="space-y-2 font-mono text-xs">
              <label className="flex items-center gap-2.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showNapCoverage}
                  onChange={(e) => setShowNapCoverage(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-800 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                />
                <span>Cobertura de cajas NAP</span>
              </label>
              <label className="flex items-center gap-2.5 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDropLines}
                  onChange={(e) => setShowDropLines(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-800 text-emerald-500 focus:ring-0 w-3.5 h-3.5"
                />
                <span>Drops de acometida (ONU)</span>
              </label>
            </div>

            <div className="space-y-3 pt-3 border-t border-slate-900 font-mono text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Simulación de falla</span>
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-850 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[11px] font-sans">Corte de feeder</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDynamicFiberCut(!dynamicFiberCut);
                      if (!dynamicFiberCut) setHighAttenuationSim(false);
                    }}
                    className={`px-2 py-1 rounded text-[9px] font-bold border ${
                      dynamicFiberCut
                        ? 'bg-rose-500 border-rose-400 text-white animate-pulse'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {dynamicFiberCut ? 'CORTE ON' : 'FORZAR CORTE'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">
                  Interrumpe el backbone. NAPs/ONUs aguas abajo quedan sin enlace.
                </p>
              </div>
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-850 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 text-[11px] font-sans">Alta atenuación</span>
                  <button
                    type="button"
                    onClick={() => {
                      setHighAttenuationSim(!highAttenuationSim);
                      if (!highAttenuationSim) setDynamicFiberCut(false);
                    }}
                    className={`px-2 py-1 rounded text-[9px] font-bold border ${
                      highAttenuationSim
                        ? 'bg-amber-600 border-amber-500 text-white animate-pulse'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    {highAttenuationSim ? 'ATENUADO' : 'ATENUAR'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 leading-snug">
                  Simula empalmes sucios / microcurvaturas (−38 dBm RX).
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[10px] text-slate-500 space-y-1">
            <div className="flex items-center gap-1.5 text-slate-300 font-bold mb-1 border-b border-slate-900 pb-1 uppercase">
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              Georreferencia
            </div>
            <p>WGS-84 · mapa fluido OSM</p>
            <p>
              OLT {centralOffice.lat.toFixed(4)}, {centralOffice.lng.toFixed(4)}
            </p>
          </div>
        </div>

        <div className="xl:col-span-6 bg-slate-950 p-5 rounded-3xl border border-emerald-900/30 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
            <span className="text-sm font-bold text-white font-mono flex items-center gap-1.5">
              <MapIcon className="w-4 h-4 text-emerald-400" />
              Visualizador ODN
            </span>
            <span className="hidden sm:block text-[10px] text-slate-500 font-mono">{bboxLabel}</span>
          </div>
          <GisLeafletMap
            clients={clients}
            naps={naps}
            onus={onus}
            showNapCoverage={showNapCoverage}
            showDropLines={showDropLines}
            dynamicFiberCut={dynamicFiberCut}
            highAttenuationSim={highAttenuationSim}
            centralOffice={centralOffice}
            splices={splices}
          />
        </div>

        <div className="xl:col-span-3 space-y-6">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center gap-2 border-b border-slate-900 pb-3">
              <Activity className="w-4 h-4 text-emerald-400" />
              Diagnóstico ODN
            </h3>
            <div className="space-y-3 font-mono text-xs">
              <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-900 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">OLT TX</span>
                  <span className="text-emerald-400 font-black">+3.20 dBm</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">ONU RX avg</span>
                  <span
                    className={`font-black ${
                      dynamicFiberCut
                        ? 'text-rose-500 animate-pulse'
                        : highAttenuationSim
                          ? 'text-amber-500'
                          : 'text-emerald-400'
                    }`}
                  >
                    {dynamicFiberCut ? 'LOS' : highAttenuationSim ? '-38.42 dBm' : '-19.24 dBm'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">NAPs</span>
                  <span className="text-white">{naps.length}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="bg-slate-900/20 border border-slate-900 rounded p-2 text-center">
                  <span className="text-slate-500 block">Fibra</span>
                  <strong className="text-white">{dynamicFiberCut ? '∞ dB' : '0.24 dB/km'}</strong>
                </div>
                <div className="bg-slate-900/20 border border-slate-900 rounded p-2 text-center">
                  <span className="text-slate-500 block">Split</span>
                  <strong className="text-white">{highAttenuationSim ? '18.4 dB' : '10.5 dB'}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
