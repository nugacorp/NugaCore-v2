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
import { Radio, Users, X, Signal } from 'lucide-react';
import type { Client, Tower } from '../../types';
import 'leaflet/dist/leaflet.css';

type WispSelection =
  | { type: 'tower'; data: Tower }
  | { type: 'client'; data: Client }
  | null;

interface WispSitesMapProps {
  towers: Tower[];
  clients: Client[];
  showCoverage: boolean;
  showBackhaul: boolean;
  showCpes: boolean;
  selectedTowerId?: string | null;
  onSelectTower?: (towerId: string | null) => void;
}

const validPoint = (lat: number, lng: number): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

const divIcon = (html: string, size = 28) =>
  L.divIcon({
    className: 'nc-wisp-marker',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

const siteIcon = (online: boolean, selected: boolean) =>
  divIcon(
    `<span class="nc-wisp-pin nc-wisp-pin--site ${online ? 'is-online' : 'is-offline'} ${selected ? 'is-selected' : ''}"><span class="nc-wisp-pin__mast"></span></span>`,
    selected ? 36 : 32,
  );

const cpeIcon = (active: boolean) =>
  divIcon(`<span class="nc-wisp-pin nc-wisp-pin--cpe ${active ? 'is-active' : ''}"></span>`, 12);

function FitDataBounds({ points }: { points: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points).pad(0.22), { animate: true, maxZoom: 13 });
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

/** Distancia haversine km (aprox. para etiquetas de enlace). */
function distanceKm(a: LatLngTuple, b: LatLngTuple): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]);
  const la2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default function WispSitesMap({
  towers,
  clients,
  showCoverage,
  showBackhaul,
  showCpes,
  selectedTowerId,
  onSelectTower,
}: WispSitesMapProps) {
  const [selection, setSelection] = useState<WispSelection>(null);

  const wispClients = useMemo(
    () =>
      clients.filter(
        (c) => validPoint(c.lat, c.lng) && c.connectionType !== 'FTTH',
      ),
    [clients],
  );

  const sitePoints = useMemo(
    () =>
      towers
        .filter((t) => validPoint(t.lat, t.lng))
        .map((t) => [t.lat, t.lng] as LatLngTuple),
    [towers],
  );

  const boundsPoints = useMemo(() => {
    const pts: LatLngTuple[] = [...sitePoints];
    if (showCpes) {
      for (const c of wispClients) pts.push([c.lat, c.lng]);
    }
    if (pts.length === 0) pts.push([19.4326, -99.1332]);
    return pts;
  }, [sitePoints, wispClients, showCpes]);

  /** Enlaces backhaul: cadena de torres por proximidad (estilo topología UISP). */
  const backhaulLinks = useMemo(() => {
    if (!showBackhaul || sitePoints.length < 2) return [] as Array<{
      key: string;
      positions: LatLngTuple[];
      km: number;
      ok: boolean;
    }>;
    const ordered = [...towers]
      .filter((t) => validPoint(t.lat, t.lng))
      .sort((a, b) => a.lat - b.lat || a.lng - b.lng);
    const links: Array<{ key: string; positions: LatLngTuple[]; km: number; ok: boolean }> = [];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i];
      const b = ordered[i + 1];
      const positions: LatLngTuple[] = [
        [a.lat, a.lng],
        [b.lat, b.lng],
      ];
      links.push({
        key: `bh-${a.id}-${b.id}`,
        positions,
        km: distanceKm(positions[0], positions[1]),
        ok: a.status === 'online' && b.status === 'online',
      });
    }
    return links;
  }, [towers, showBackhaul, sitePoints.length]);

  /** CPE → torre más cercana (enlace de acceso). */
  const accessLinks = useMemo(() => {
    if (!showCpes) return [] as Array<{ key: string; positions: LatLngTuple[]; ok: boolean }>;
    const sites = towers.filter((t) => validPoint(t.lat, t.lng));
    return wispClients
      .map((c) => {
        if (sites.length === 0) return null;
        let best = sites[0];
        let bestD = distanceKm([c.lat, c.lng], [best.lat, best.lng]);
        for (const t of sites.slice(1)) {
          const d = distanceKm([c.lat, c.lng], [t.lat, t.lng]);
          if (d < bestD) {
            best = t;
            bestD = d;
          }
        }
        if (bestD > (best.coverageRadiusKm || 12) * 1.2) return null;
        return {
          key: `acc-${c.id}-${best.id}`,
          positions: [
            [best.lat, best.lng],
            [c.lat, c.lng],
          ] as LatLngTuple[],
          ok: best.status === 'online' && c.status === 'active',
        };
      })
      .filter(Boolean) as Array<{ key: string; positions: LatLngTuple[]; ok: boolean }>;
  }, [wispClients, towers, showCpes]);

  const defaultCenter = boundsPoints[0] as LatLngExpression;

  return (
    <div className="relative w-full h-[420px] md:h-[480px] rounded-2xl border border-slate-700/80 overflow-hidden bg-[#e8eef5]">
      <MapContainer
        center={defaultCenter}
        zoom={11}
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

        {backhaulLinks.map((link) => (
          <Polyline
            key={link.key}
            positions={link.positions}
            pathOptions={{
              color: link.ok ? '#2563eb' : '#f43f5e',
              weight: 3,
              opacity: 0.85,
            }}
          >
            <Popup>
              Backhaul · {link.km.toFixed(1)} km · {link.ok ? 'UP' : 'DEGRADADO'}
            </Popup>
          </Polyline>
        ))}

        {accessLinks.map((link) => (
          <Polyline
            key={link.key}
            positions={link.positions}
            pathOptions={{
              color: link.ok ? '#38bdf8' : '#fb7185',
              weight: 1.25,
              opacity: 0.55,
              dashArray: '2 6',
            }}
          />
        ))}

        {towers.map((tower) =>
          validPoint(tower.lat, tower.lng) ? (
            <React.Fragment key={tower.id}>
              {showCoverage && (
                <Circle
                  center={[tower.lat, tower.lng]}
                  radius={Math.max(300, (Number(tower.coverageRadiusKm) || 5) * 1000)}
                  pathOptions={{
                    color: tower.status === 'online' ? '#3b82f6' : '#e11d48',
                    fillColor: tower.status === 'online' ? '#3b82f6' : '#e11d48',
                    fillOpacity: selectedTowerId === tower.id ? 0.14 : 0.07,
                    weight: selectedTowerId === tower.id ? 2 : 1.2,
                    opacity: 0.55,
                  }}
                />
              )}
              <Marker
                position={[tower.lat, tower.lng]}
                icon={siteIcon(tower.status === 'online', selectedTowerId === tower.id)}
                eventHandlers={{
                  click: () => {
                    setSelection({ type: 'tower', data: tower });
                    onSelectTower?.(tower.id);
                  },
                }}
              >
                <Popup>
                  <strong>{tower.name}</strong>
                  <br />
                  {tower.status} · ping {tower.pingMs} ms
                </Popup>
              </Marker>
            </React.Fragment>
          ) : null,
        )}

        {showCpes &&
          wispClients.map((client) => (
            <Marker
              key={client.id}
              position={[client.lat, client.lng]}
              icon={cpeIcon(client.status === 'active')}
              eventHandlers={{
                click: () => {
                  setSelection({ type: 'client', data: client });
                  onSelectTower?.(null);
                },
              }}
            />
          ))}
      </MapContainer>

      <div className="absolute top-3 left-3 z-[500] bg-white/95 border border-slate-200 p-3 rounded-xl text-[10px] space-y-1.5 font-mono text-slate-600 shadow-md">
        <span className="font-bold text-slate-800 block uppercase tracking-wide text-[9px]">Sitios WISP</span>
        <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" /> Torre / AP</div>
        <div className="flex items-center gap-2"><span className="w-4 h-0.5 bg-blue-600 inline-block" /> Backhaul</div>
        <div className="flex items-center gap-2"><span className="w-4 h-0.5 border-t border-dashed border-sky-400 inline-block" /> Acceso CPE</div>
        <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-sky-500 inline-block" /> CPE</div>
      </div>

      {selection && (
        <aside className="absolute top-3 right-3 z-[510] w-[250px] bg-white border border-slate-200 rounded-xl shadow-xl text-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              {selection.type === 'tower' ? (
                <Radio className="w-3.5 h-3.5 text-blue-600" />
              ) : (
                <Users className="w-3.5 h-3.5 text-sky-600" />
              )}
              <span className="uppercase tracking-wide text-[10px] text-slate-500">
                {selection.type === 'tower' ? 'Sitio' : 'CPE'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelection(null);
                onSelectTower?.(null);
              }}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-3 space-y-1.5 text-[11px] font-mono">
            {selection.type === 'tower' && (
              <>
                <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                <p className="flex items-center gap-1">
                  <Signal className="w-3 h-3" />
                  {selection.data.status} · {selection.data.pingMs} ms
                </p>
                <p>IP {selection.data.ip}</p>
                <p>
                  Equipo {selection.data.equipment?.[0]?.name || selection.data.equipment?.[0]?.brand || '—'}
                </p>
                <p>CPU {selection.data.cpu}% · Cobertura {selection.data.coverageRadiusKm} km</p>
              </>
            )}
            {selection.type === 'client' && (
              <>
                <p className="font-sans font-semibold text-sm text-slate-900">{selection.data.name}</p>
                <p>{selection.data.city}</p>
                <p>IP {selection.data.ip || '—'}</p>
                <p>Estado {selection.data.status}</p>
              </>
            )}
          </div>
        </aside>
      )}

      <style>{`
        .nc-wisp-marker { background: transparent; border: 0; }
        .nc-wisp-pin {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 9999px;
          box-shadow: 0 2px 10px rgba(30, 64, 175, 0.28);
          border: 2px solid #fff;
        }
        .nc-wisp-pin--site { background: #2563eb; }
        .nc-wisp-pin--site.is-offline { background: #e11d48; }
        .nc-wisp-pin--site.is-selected { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.35), 0 2px 10px rgba(30,64,175,0.35); }
        .nc-wisp-pin__mast {
          width: 3px; height: 12px; background: #fff; border-radius: 1px; position: relative;
        }
        .nc-wisp-pin__mast::before, .nc-wisp-pin__mast::after {
          content: ''; position: absolute; left: 50%; transform: translateX(-50%);
          border: 1.5px solid #fff; border-radius: 50%;
        }
        .nc-wisp-pin__mast::before { width: 10px; height: 10px; top: -2px; opacity: 0.9; }
        .nc-wisp-pin__mast::after { width: 16px; height: 16px; top: -5px; opacity: 0.4; }
        .nc-wisp-pin--cpe { background: #0ea5e9; border-width: 1.5px; }
        .nc-wisp-pin--cpe.is-active { background: #0284c7; }
        .leaflet-container { font: inherit; background: #e8eef5; }
        .leaflet-control-zoom a {
          background: #fff !important; color: #0f172a !important; border-color: #e2e8f0 !important;
        }
      `}</style>
    </div>
  );
}
