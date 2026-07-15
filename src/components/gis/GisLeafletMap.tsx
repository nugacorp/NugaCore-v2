import React, { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Circle,
  Marker,
  Polyline,
  Popup,
  useMap,
  ZoomControl,
} from 'react-leaflet';
import L, { type LatLngExpression, type LatLngTuple } from 'leaflet';
import { AlertTriangle, Cpu, Database, Radio, Users, X } from 'lucide-react';
import type { Client, NapBox, OnuFTTH, Tower } from '../../types';
import 'leaflet/dist/leaflet.css';

export type GisNetworkLayer = 'all' | 'wisp' | 'ftth';
export type GisSelection =
  | { type: 'tower'; data: Tower }
  | { type: 'nap'; data: NapBox }
  | { type: 'client'; data: Client }
  | { type: 'olt'; data: { id: string; name: string; lat: number; lng: number; capacity: string } }
  | null;

interface GisLeafletMapProps {
  towers: Tower[];
  clients: Client[];
  naps: NapBox[];
  onus: OnuFTTH[];
  activeNetworkLayer: GisNetworkLayer;
  showCoverageRadius: boolean;
  showDropLines: boolean;
  dynamicFiberCut: boolean;
  highAttenuationSim: boolean;
  showPlannedTower: boolean;
  plannedLat: number;
  plannedLng: number;
  plannedRadiusKm: number;
  centralOffice: { id: string; name: string; lat: number; lng: number; capacity: string };
  splices: Array<{ id: string; name: string; lat: number; lng: number }>;
}

const validPoint = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

const divIcon = (html: string, className = '', size = 28) =>
  L.divIcon({
    className: `nc-gis-marker ${className}`,
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

const towerIcon = (online: boolean) =>
  divIcon(
    `<span class="nc-gis-pin nc-gis-pin--tower ${online ? 'is-online' : 'is-offline'}"><span class="nc-gis-pin__mast"></span></span>`,
    '',
    32,
  );

const napIcon = (cut: boolean) =>
  divIcon(
    `<span class="nc-gis-pin nc-gis-pin--nap ${cut ? 'is-cut' : ''}"><span class="nc-gis-pin__box"></span></span>`,
    '',
    26,
  );

const clientIcon = (active: boolean) =>
  divIcon(
    `<span class="nc-gis-pin nc-gis-pin--client ${active ? 'is-active' : ''}"></span>`,
    '',
    14,
  );

const oltIcon = () =>
  divIcon(
    `<span class="nc-gis-pin nc-gis-pin--olt"><span class="nc-gis-pin__core"></span></span>`,
    '',
    34,
  );

const spliceIcon = () =>
  divIcon(`<span class="nc-gis-pin nc-gis-pin--splice"></span>`, '', 16);

function FitDataBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds.pad(0.18), { animate: true, maxZoom: 14 });
  }, [map, points]);
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function GisLeafletMap({
  towers,
  clients,
  naps,
  onus,
  activeNetworkLayer,
  showCoverageRadius,
  showDropLines,
  dynamicFiberCut,
  highAttenuationSim,
  showPlannedTower,
  plannedLat,
  plannedLng,
  plannedRadiusKm,
  centralOffice,
  splices,
}: GisLeafletMapProps) {
  const [selection, setSelection] = useState<GisSelection>(null);
  const showFtth = activeNetworkLayer === 'all' || activeNetworkLayer === 'ftth';
  const showWisp = activeNetworkLayer === 'all' || activeNetworkLayer === 'wisp';

  const boundsPoints = useMemo(() => {
    const pts: LatLngTuple[] = [];
    if (validPoint(centralOffice.lat, centralOffice.lng)) {
      pts.push([centralOffice.lat, centralOffice.lng]);
    }
    for (const t of towers) if (validPoint(t.lat, t.lng)) pts.push([t.lat, t.lng]);
    for (const n of naps) if (validPoint(n.lat, n.lng)) pts.push([n.lat, n.lng]);
    for (const c of clients) if (validPoint(c.lat, c.lng)) pts.push([c.lat, c.lng]);
    for (const s of splices) if (validPoint(s.lat, s.lng)) pts.push([s.lat, s.lng]);
    if (pts.length === 0) pts.push([19.4326, -99.1332]);
    return pts;
  }, [towers, naps, clients, splices, centralOffice]);

  const defaultCenter = boundsPoints[0] as LatLngExpression;

  const dropLines = useMemo(() => {
    if (!showDropLines || !showFtth) return [] as Array<{ key: string; positions: LatLngTuple[]; offline: boolean }>;
    return onus
      .map((onu) => {
        const nap = naps.find((n) => n.id === onu.napId);
        const client = clients.find((c) => c.id === onu.clientId);
        if (!nap || !client) return null;
        if (!validPoint(nap.lat, nap.lng) || !validPoint(client.lat, client.lng)) return null;
        return {
          key: `drop-${onu.id}`,
          positions: [
            [nap.lat, nap.lng],
            [client.lat, client.lng],
          ] as LatLngTuple[],
          offline: onu.status !== 'online' || dynamicFiberCut,
        };
      })
      .filter(Boolean) as Array<{ key: string; positions: LatLngTuple[]; offline: boolean }>;
  }, [onus, naps, clients, showDropLines, showFtth, dynamicFiberCut]);

  const backboneColor = dynamicFiberCut ? '#ef4444' : '#6366f1';
  const trunkColor = dynamicFiberCut ? '#ef4444' : highAttenuationSim ? '#d97706' : '#10b981';

  return (
    <div className="relative w-full h-[520px] md:h-[560px] rounded-2xl border border-slate-800 overflow-hidden bg-[#e8eef5]">
      <MapContainer
        center={defaultCenter}
        zoom={12}
        className="h-full w-full z-0"
        zoomControl={false}
        scrollWheelZoom
        preferCanvas
      >
        {/* Basemap claro tipo UISP — buena lectura de calles/terreno */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <FitDataBounds points={boundsPoints} />
        <InvalidateOnResize />

        {showFtth && (
          <>
            {splices.map((sp) =>
              validPoint(sp.lat, sp.lng) ? (
                <React.Fragment key={`bb-${sp.id}`}>
                  <Polyline
                    positions={[
                      [centralOffice.lat, centralOffice.lng],
                      [sp.lat, sp.lng],
                    ]}
                    pathOptions={{
                      color: backboneColor,
                      weight: dynamicFiberCut ? 3 : 5,
                      opacity: dynamicFiberCut ? 0.55 : 0.9,
                      lineCap: 'round',
                    }}
                  />
                  <Marker
                    position={[sp.lat, sp.lng]}
                    icon={spliceIcon()}
                    eventHandlers={{
                      click: () =>
                        setSelection({
                          type: 'olt',
                          data: {
                            id: sp.id,
                            name: sp.name,
                            lat: sp.lat,
                            lng: sp.lng,
                            capacity: 'Empalme troncal',
                          },
                        }),
                    }}
                  />
                </React.Fragment>
              ) : null,
            )}

            {naps.map((nap, index) => {
              if (!validPoint(nap.lat, nap.lng)) return null;
              const nearest = splices[index % Math.max(1, splices.length)];
              if (!nearest || !validPoint(nearest.lat, nearest.lng)) return null;
              return (
                <Polyline
                  key={`trunk-${nap.id}`}
                  positions={[
                    [nearest.lat, nearest.lng],
                    [nap.lat, nap.lng],
                  ]}
                  pathOptions={{
                    color: trunkColor,
                    weight: 2.5,
                    opacity: 0.85,
                    dashArray: highAttenuationSim ? '6 4' : undefined,
                  }}
                />
              );
            })}

            {dropLines.map((line) => (
              <Polyline
                key={line.key}
                positions={line.positions}
                pathOptions={{
                  color: line.offline ? '#f43f5e' : '#38bdf8',
                  weight: 1.5,
                  opacity: 0.75,
                  dashArray: '4 6',
                }}
              />
            ))}

            {validPoint(centralOffice.lat, centralOffice.lng) && (
              <Marker
                position={[centralOffice.lat, centralOffice.lng]}
                icon={oltIcon()}
                eventHandlers={{
                  click: () => setSelection({ type: 'olt', data: centralOffice }),
                }}
              >
                <Popup>
                  <strong>{centralOffice.name}</strong>
                  <br />
                  {centralOffice.capacity}
                </Popup>
              </Marker>
            )}

            {naps.map((nap) =>
              validPoint(nap.lat, nap.lng) ? (
                <React.Fragment key={nap.id}>
                  {showCoverageRadius && (
                    <Circle
                      center={[nap.lat, nap.lng]}
                      radius={Math.max(40, Number(nap.coverageMeters) || 160)}
                      pathOptions={{
                        color: dynamicFiberCut ? '#f43f5e' : '#10b981',
                        fillColor: dynamicFiberCut ? '#f43f5e' : '#10b981',
                        fillOpacity: 0.08,
                        weight: 1,
                        opacity: 0.45,
                      }}
                    />
                  )}
                  <Marker
                    position={[nap.lat, nap.lng]}
                    icon={napIcon(dynamicFiberCut)}
                    eventHandlers={{ click: () => setSelection({ type: 'nap', data: nap }) }}
                  />
                </React.Fragment>
              ) : null,
            )}
          </>
        )}

        {showWisp &&
          towers.map((tower) =>
            validPoint(tower.lat, tower.lng) ? (
              <React.Fragment key={tower.id}>
                {showCoverageRadius && (
                  <Circle
                    center={[tower.lat, tower.lng]}
                    radius={Math.max(200, (Number(tower.coverageRadiusKm) || 5) * 1000)}
                    pathOptions={{
                      color: tower.status === 'online' ? '#6366f1' : '#f43f5e',
                      fillColor: tower.status === 'online' ? '#6366f1' : '#f43f5e',
                      fillOpacity: 0.07,
                      weight: 1.25,
                      opacity: 0.5,
                    }}
                  />
                )}
                <Marker
                  position={[tower.lat, tower.lng]}
                  icon={towerIcon(tower.status === 'online')}
                  eventHandlers={{ click: () => setSelection({ type: 'tower', data: tower }) }}
                />
              </React.Fragment>
            ) : null,
          )}

        {(showWisp || showFtth) &&
          clients.map((client) => {
            if (!validPoint(client.lat, client.lng)) return null;
            const isFtth = client.connectionType === 'FTTH' || onus.some((o) => o.clientId === client.id);
            if (activeNetworkLayer === 'ftth' && !isFtth) return null;
            if (activeNetworkLayer === 'wisp' && isFtth) return null;
            return (
              <Marker
                key={client.id}
                position={[client.lat, client.lng]}
                icon={clientIcon(client.status === 'active')}
                eventHandlers={{ click: () => setSelection({ type: 'client', data: client }) }}
              />
            );
          })}

        {showPlannedTower && validPoint(plannedLat, plannedLng) && (
          <>
            <Circle
              center={[plannedLat, plannedLng]}
              radius={plannedRadiusKm * 1000}
              pathOptions={{
                color: '#34d399',
                fillColor: '#34d399',
                fillOpacity: 0.08,
                weight: 1.5,
                dashArray: '4 6',
              }}
            />
            <Marker
              position={[plannedLat, plannedLng]}
              icon={divIcon(
                `<span class="nc-gis-pin nc-gis-pin--planned"><span class="nc-gis-pin__plus"></span></span>`,
                '',
                28,
              )}
            />
          </>
        )}
      </MapContainer>

      {/* Leyenda */}
      <div className="absolute top-3 left-3 z-[500] bg-white/95 border border-slate-200 p-3 rounded-xl text-[10px] space-y-1.5 font-mono text-slate-600 shadow-md max-w-[200px]">
        <span className="font-bold text-slate-800 block uppercase tracking-wide text-[9px]">Nomenclatura</span>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> OLT / empalme</div>
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded border-2 border-emerald-500 bg-white inline-block" /> NAP</div>
        <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" /> Torre WISP</div>
        <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 inline-block" /> Cliente</div>
        <div className="flex items-center gap-2"><span className="w-4 h-0.5 bg-gradient-to-r from-indigo-500 to-pink-400 inline-block" /> Backbone</div>
      </div>

      {dynamicFiberCut && (
        <div className="absolute top-3 right-3 z-[500] bg-rose-600 text-white px-3 py-2 rounded-xl text-[11px] font-mono flex items-center gap-1.5 shadow-lg animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5" />
          Corte en anillo principal
        </div>
      )}

      {/* Panel detalle estilo UISP */}
      {selection && (
        <aside className="absolute top-3 right-3 z-[510] w-[260px] max-h-[calc(100%-1.5rem)] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl text-slate-700">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              {selection.type === 'olt' && <Cpu className="w-3.5 h-3.5 text-indigo-500" />}
              {selection.type === 'nap' && <Database className="w-3.5 h-3.5 text-emerald-500" />}
              {selection.type === 'tower' && <Radio className="w-3.5 h-3.5 text-indigo-500" />}
              {selection.type === 'client' && <Users className="w-3.5 h-3.5 text-sky-500" />}
              <span className="uppercase tracking-wide text-[10px] text-slate-500">{selection.type}</span>
            </div>
            <button type="button" onClick={() => setSelection(null)} className="text-slate-400 hover:text-slate-700 p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-3 space-y-1.5 text-[11px] font-mono">
            {selection.type === 'olt' && (
              <>
                <p className="font-sans font-semibold text-sm text-slate-900 leading-snug">{selection.data.name}</p>
                <p>Capacidad: {selection.data.capacity}</p>
                <p>Lat {selection.data.lat.toFixed(5)} · Lng {selection.data.lng.toFixed(5)}</p>
              </>
            )}
            {selection.type === 'nap' && (
              <>
                <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                <p>PON: {selection.data.ponPort || '—'}</p>
                <p>Split: {selection.data.splitRatio || '—'}</p>
                <p>Cobertura: {selection.data.coverageMeters}m</p>
                <p>
                  Fibras libres:{' '}
                  <strong className={dynamicFiberCut ? 'text-rose-600' : 'text-emerald-600'}>
                    {dynamicFiberCut ? '0 (corte)' : selection.data.fibersFree}
                  </strong>
                </p>
              </>
            )}
            {selection.type === 'tower' && (
              <>
                <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                <p>
                  Estado:{' '}
                  <strong className={selection.data.status === 'online' ? 'text-emerald-600' : 'text-rose-600'}>
                    {selection.data.status}
                  </strong>
                </p>
                <p>IP: {selection.data.ip}</p>
                <p>CPU: {selection.data.cpu}% · Ping {selection.data.pingMs}ms</p>
                <p>Cobertura: {selection.data.coverageRadiusKm} km</p>
              </>
            )}
            {selection.type === 'client' && (
              <>
                <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                <p>{selection.data.city}</p>
                <p>Servicio: {selection.data.connectionType || 'WISP'}</p>
                <p>IP: {selection.data.ip || '—'}</p>
                <p>
                  Cuenta:{' '}
                  <strong className={selection.data.status === 'active' ? 'text-emerald-600' : 'text-rose-600'}>
                    {selection.data.status}
                  </strong>
                </p>
              </>
            )}
          </div>
        </aside>
      )}

      <style>{`
        .nc-gis-marker { background: transparent; border: 0; }
        .nc-gis-pin {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 9999px;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.25);
          border: 2px solid #fff;
          transition: transform 0.15s ease;
        }
        .nc-gis-pin:hover { transform: scale(1.08); }
        .nc-gis-pin--tower { background: #4f46e5; }
        .nc-gis-pin--tower.is-offline { background: #e11d48; }
        .nc-gis-pin__mast {
          width: 3px; height: 12px; background: #fff; border-radius: 1px; position: relative;
        }
        .nc-gis-pin__mast::before, .nc-gis-pin__mast::after {
          content: ''; position: absolute; left: 50%; transform: translateX(-50%);
          border: 1.5px solid #fff; border-radius: 50%;
        }
        .nc-gis-pin__mast::before { width: 10px; height: 10px; top: -2px; opacity: 0.85; }
        .nc-gis-pin__mast::after { width: 16px; height: 16px; top: -5px; opacity: 0.45; }
        .nc-gis-pin--nap {
          background: #fff; border-color: #10b981; border-radius: 6px;
        }
        .nc-gis-pin--nap.is-cut { border-color: #e11d48; }
        .nc-gis-pin__box {
          width: 8px; height: 8px; background: #10b981; border-radius: 2px;
        }
        .nc-gis-pin--nap.is-cut .nc-gis-pin__box { background: #e11d48; }
        .nc-gis-pin--client { background: #0ea5e9; border-width: 1.5px; }
        .nc-gis-pin--client.is-active { background: #0284c7; }
        .nc-gis-pin--olt { background: #4f46e5; }
        .nc-gis-pin__core {
          width: 8px; height: 8px; background: #fff; border-radius: 2px; transform: rotate(45deg);
        }
        .nc-gis-pin--splice { background: #1e293b; border-color: #818cf8; width: 12px; height: 12px; margin: auto; }
        .nc-gis-pin--planned { background: #34d399; }
        .nc-gis-pin__plus {
          width: 10px; height: 2px; background: #064e3b; position: relative;
        }
        .nc-gis-pin__plus::after {
          content: ''; position: absolute; left: 4px; top: -4px; width: 2px; height: 10px; background: #064e3b;
        }
        .leaflet-container { font: inherit; background: #e8eef5; }
        .leaflet-control-zoom a {
          background: #fff !important; color: #0f172a !important; border-color: #e2e8f0 !important;
        }
        .leaflet-popup-content-wrapper { border-radius: 10px; }
      `}</style>
    </div>
  );
}
