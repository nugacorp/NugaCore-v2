import type { FiberSegment, NapBox } from '../types';

const csvEscape = (value: unknown): string => {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
};

export const NAP_CSV_TEMPLATE = `id,name,lat,lng,pon_port,split_ratio,fibers_total,coverage_m
NAP-01,Caja Centro,19.4285,-99.1655,1/1,1:8,8,250
`;

export const SEGMENT_CSV_TEMPLATE = `id,name,from_id,to_id,type,thread_count,coordinates
SEG-01,Feeder Centro,OLT-1,NAP-01,feeder,12,"[[19.43,-99.17],[19.428,-99.165]]"
`;

export function napsToCsv(naps: NapBox[]): string {
  const header = ['id', 'name', 'lat', 'lng', 'pon_port', 'split_ratio', 'fibers_total', 'coverage_m'];
  const rows = naps.map((n) => [
    n.id,
    n.name,
    n.lat,
    n.lng,
    n.ponPort || '',
    n.splitRatio || '',
    n.fibersTotal ?? (n.ports?.length ?? ''),
    n.coverageMeters ?? '',
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

export function segmentsToCsv(segments: FiberSegment[]): string {
  const header = ['id', 'name', 'from_id', 'to_id', 'type', 'thread_count', 'coordinates'];
  const rows = segments.map((s) => [
    s.id,
    s.name,
    s.fromRef || '',
    s.toRef || '',
    s.segmentType || 'feeder',
    s.threadCount ?? 12,
    JSON.stringify(s.coordinates || []),
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

export function toFtthGeoJson(naps: NapBox[], segments: FiberSegment[]) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      ...naps
        .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lng))
        .map((n) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [Number(n.lng), Number(n.lat)] },
          properties: {
            id: n.id,
            name: n.name,
            pon_port: n.ponPort || '',
            split_ratio: n.splitRatio || '',
            fibers_total: n.fibersTotal ?? n.ports?.length,
            coverage_m: n.coverageMeters,
          },
        })),
      ...segments
        .filter((s) => Array.isArray(s.coordinates) && s.coordinates.length >= 2)
        .map((s) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: s.coordinates.map(([lat, lng]) => [Number(lng), Number(lat)]),
          },
          properties: {
            id: s.id,
            name: s.name,
            from_id: s.fromRef || '',
            to_id: s.toRef || '',
            type: s.segmentType || 'feeder',
            thread_count: s.threadCount ?? 12,
            nap_id: s.napId || '',
            pon_port: s.ponPort || '',
          },
        })),
    ],
  };
}

/** Descarga un archivo en el navegador del WISP (sin acceso a VPS). */
export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
