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
import { AlertTriangle, Cpu, Users, X } from 'lucide-react';
import type { Client, FiberSegment, NapBox, OnuFTTH } from '../../types';
import NapInternalView from './NapInternalView';
import 'leaflet/dist/leaflet.css';

export type FtthSelection =
  | { type: 'nap'; data: NapBox }
  | { type: 'client'; data: Client }
  | { type: 'olt'; data: { id: string; name: string; lat: number; lng: number; capacity: string } }
  | null;

interface GisLeafletMapProps {
  clients: Client[];
  naps: NapBox[];
  onus: OnuFTTH[];
  fiberSegments?: FiberSegment[];
  showNapCoverage: boolean;
  showDropLines: boolean;
  dynamicFiberCut: boolean;
  highAttenuationSim: boolean;
  centralOffice: { id: string; name: string; lat: number; lng: number; capacity: string };
  splices: Array<{ id: string; name: string; lat: number; lng: number }>;
  onPortUpdate?: (
    napId: string,
    portNum: number,
    patch: {
      status?: 'free' | 'occupied';
      client?: string;
      continuesToNapId?: string;
      continuesToThread?: number;
    },
  ) => Promise<void>;
}

const validPoint = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

const divIcon = (html: string, size = 28) =>
  L.divIcon({
    className: 'nc-ftth-marker',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

const napIcon = (cut: boolean) =>
  divIcon(
    `<span class="nc-ftth-pin nc-ftth-pin--nap ${cut ? 'is-cut' : ''}"><span class="nc-ftth-pin__box"></span></span>`,
    26,
  );

const clientIcon = (down: boolean) =>
  divIcon(
    `<span class="nc-ftth-pin nc-ftth-pin--onu ${down ? 'is-down' : ''}"></span>`,
    12,
  );

const oltIcon = () =>
  divIcon(`<span class="nc-ftth-pin nc-ftth-pin--olt"><span class="nc-ftth-pin__core"></span></span>`, 34);

const spliceIcon = () => divIcon(`<span class="nc-ftth-pin nc-ftth-pin--splice"></span>`, 16);

function FitDataBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points).pad(0.2), { animate: true, maxZoom: 15 });
  }, [map, points]);
  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function GisLeafletMap({
  clients,
  naps,
  onus,
  fiberSegments = [],
  showNapCoverage,
  showDropLines,
  dynamicFiberCut,
  highAttenuationSim,
  centralOffice,
  splices,
  onPortUpdate,
}: GisLeafletMapProps) {
  const [selection, setSelection] = useState<FtthSelection>(null);

  const ftthClients = useMemo(
    () =>
      clients.filter(
        (c) =>
          validPoint(c.lat, c.lng) &&
          (c.connectionType === 'FTTH' || onus.some((o) => o.clientId === c.id)),
      ),
    [clients, onus],
  );

  const boundsPoints = useMemo(() => {
    const pts: LatLngTuple[] = [];
    if (validPoint(centralOffice.lat, centralOffice.lng)) {
      pts.push([centralOffice.lat, centralOffice.lng]);
    }
    for (const n of naps) if (validPoint(n.lat, n.lng)) pts.push([n.lat, n.lng]);
    for (const c of ftthClients) pts.push([c.lat, c.lng]);
    for (const s of splices) if (validPoint(s.lat, s.lng)) pts.push([s.lat, s.lng]);
    for (const seg of fiberSegments) {
      for (const [lat, lng] of seg.coordinates) {
        if (validPoint(lat, lng)) pts.push([lat, lng]);
      }
    }
    if (pts.length === 0) pts.push([19.4326, -99.1332]);
    return pts;
  }, [naps, ftthClients, splices, centralOffice, fiberSegments]);

  const dropLines = useMemo(() => {
    if (!showDropLines) return [] as Array<{ key: string; positions: LatLngTuple[]; offline: boolean }>;
    return onus
      .map((onu) => {
        const nap = naps.find((n) => n.id === onu.napId);
        const client = clients.find((c) => c.id === onu.clientId);
        if (!nap || !client || !validPoint(nap.lat, nap.lng) || !validPoint(client.lat, client.lng)) {
          return null;
        }
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
  }, [onus, naps, clients, showDropLines, dynamicFiberCut]);

  const backboneColor = dynamicFiberCut ? '#ef4444' : '#7c3aed';
  const trunkColor = dynamicFiberCut ? '#ef4444' : highAttenuationSim ? '#d97706' : '#059669';
  const defaultCenter = boundsPoints[0] as LatLngExpression;

  return (
    <div className="relative w-full h-[520px] md:h-[580px] rounded-2xl border border-emerald-900/40 overflow-hidden bg-[#eef6f2]">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        className="h-full w-full z-0"
        zoomControl={false}
        scrollWheelZoom
        preferCanvas
      >
        <TileLayer
          attribution='&copy; OSM &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <FitDataBounds points={boundsPoints} />
        <InvalidateOnResize />

        {fiberSegments.map((seg) => {
          const positions = seg.coordinates
            .filter(([lat, lng]) => validPoint(lat, lng))
            .map(([lat, lng]) => [lat, lng] as LatLngTuple);
          if (positions.length < 2) return null;
          const isFeeder = seg.segmentType === 'feeder';
          return (
            <Polyline
              key={`seg-${seg.id}`}
              positions={positions}
              pathOptions={{
                color: isFeeder ? backboneColor : trunkColor,
                weight: isFeeder ? 4 : 2.5,
                opacity: 0.88,
                dashArray: seg.segmentType === 'drop' ? '4 4' : undefined,
              }}
            />
          );
        })}

        {splices.map((sp) =>
          validPoint(sp.lat, sp.lng) ? (
            <React.Fragment key={`bb-${sp.id}`}>
              {validPoint(centralOffice.lat, centralOffice.lng) && (
                <Polyline
                  positions={[
                    [centralOffice.lat, centralOffice.lng],
                    [sp.lat, sp.lng],
                  ]}
                  pathOptions={{
                    color: backboneColor,
                    weight: dynamicFiberCut ? 3 : 5,
                    opacity: dynamicFiberCut ? 0.55 : 0.92,
                    lineCap: 'round',
                  }}
                />
              )}
              <Marker position={[sp.lat, sp.lng]} icon={spliceIcon()} />
            </React.Fragment>
          ) : null,
        )}

        {fiberSegments.length === 0 &&
          splices.length > 0 &&
          naps.map((nap, index) => {
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
              color: line.offline ? '#f43f5e' : '#0ea5e9',
              weight: 1.5,
              opacity: 0.8,
              dashArray: '3 5',
            }}
          />
        ))}

        {validPoint(centralOffice.lat, centralOffice.lng) && (
          <Marker
            position={[centralOffice.lat, centralOffice.lng]}
            icon={oltIcon()}
            eventHandlers={{ click: () => setSelection({ type: 'olt', data: centralOffice }) }}
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
              {showNapCoverage && (
                <Circle
                  center={[nap.lat, nap.lng]}
                  radius={Math.max(40, Number(nap.coverageMeters) || 160)}
                  pathOptions={{
                    color: dynamicFiberCut ? '#f43f5e' : '#059669',
                    fillColor: dynamicFiberCut ? '#f43f5e' : '#10b981',
                    fillOpacity: 0.1,
                    weight: 1,
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

        {ftthClients.map((client) => {
          const onu = onus.find((o) => o.clientId === client.id);
          const down = dynamicFiberCut || onu?.status === 'offline' || onu?.status === 'dying_gasp';
          return (
            <Marker
              key={client.id}
              position={[client.lat, client.lng]}
              icon={clientIcon(!!down)}
              eventHandlers={{ click: () => setSelection({ type: 'client', data: client }) }}
            />
          );
        })}
      </MapContainer>

      <div className="absolute top-3 left-3 z-[500] bg-white/95 border border-emerald-100 p-3 rounded-xl text-[10px] space-y-1.5 font-mono text-slate-600 shadow-md max-w-[210px]">
        <span className="font-bold text-emerald-800 block uppercase tracking-wide text-[9px]">Planta FTTH</span>
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded bg-violet-600 inline-block" /> OLT cabecera</div>
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded border-2 border-emerald-600 bg-white inline-block" /> Caja NAP</div>
        <div className="flex items-center gap-2"><span className="w-4 h-0.5 bg-violet-600 inline-block" /> Feeder / backbone</div>
        <div className="flex items-center gap-2"><span className="w-4 h-0.5 bg-emerald-600 inline-block" /> Distribución</div>
        <div className="flex items-center gap-2"><span className="w-4 h-0.5 border-t border-dashed border-sky-500 inline-block" /> Drop ONU</div>
      </div>

      {dynamicFiberCut && (
        <div className="absolute top-3 right-3 z-[500] bg-rose-600 text-white px-3 py-2 rounded-xl text-[11px] font-mono flex items-center gap-1.5 shadow-lg animate-pulse">
          <AlertTriangle className="w-3.5 h-3.5" />
          Corte en feeder principal
        </div>
      )}

      {selection?.type === 'nap' ? (
        <NapInternalView
          nap={selection.data}
          allNaps={naps}
          onClose={() => setSelection(null)}
          onPortUpdate={onPortUpdate}
        />
      ) : (
        selection && (
          <aside className="absolute bottom-3 right-3 z-[510] w-[260px] max-h-[55%] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl text-slate-700">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                {selection.type === 'olt' && <Cpu className="w-3.5 h-3.5 text-violet-600" />}
                {selection.type === 'client' && <Users className="w-3.5 h-3.5 text-sky-600" />}
                <span className="uppercase tracking-wide text-[10px] text-slate-500">{selection.type}</span>
              </div>
              <button type="button" onClick={() => setSelection(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-3 py-3 space-y-1.5 text-[11px] font-mono">
              {selection.type === 'olt' && (
                <>
                  <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                  <p>{selection.data.capacity}</p>
                  <p>
                    {selection.data.lat.toFixed(5)}, {selection.data.lng.toFixed(5)}
                  </p>
                </>
              )}
              {selection.type === 'client' && (
                <>
                  <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                  <p>FTTH · {selection.data.city}</p>
                  <p>IP {selection.data.ip || '—'}</p>
                  <p>Estatus {selection.data.status}</p>
                </>
              )}
            </div>
          </aside>
        )
      )}

      <style>{`
        .nc-ftth-marker { background: transparent; border: 0; }
        .nc-ftth-pin {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 9999px;
          box-shadow: 0 2px 8px rgba(6, 78, 59, 0.22);
          border: 2px solid #fff;
        }
        .nc-ftth-pin--olt { background: #7c3aed; }
        .nc-ftth-pin__core {
          width: 8px; height: 8px; background: #fff; border-radius: 2px; transform: rotate(45deg);
        }
        .nc-ftth-pin--nap { background: #fff; border-color: #059669; border-radius: 6px; }
        .nc-ftth-pin--nap.is-cut { border-color: #e11d48; }
        .nc-ftth-pin__box { width: 8px; height: 8px; background: #059669; border-radius: 2px; }
        .nc-ftth-pin--nap.is-cut .nc-ftth-pin__box { background: #e11d48; }
        .nc-ftth-pin--onu { background: #0ea5e9; border-width: 1.5px; }
        .nc-ftth-pin--onu.is-down { background: #e11d48; }
        .nc-ftth-pin--splice { background: #1e293b; border-color: #a78bfa; }
        .leaflet-container { font: inherit; background: #eef6f2; }
        .leaflet-control-zoom a {
          background: #fff !important; color: #0f172a !important; border-color: #d1fae5 !important;
        }
      `}</style>
    </div>
  );
}
