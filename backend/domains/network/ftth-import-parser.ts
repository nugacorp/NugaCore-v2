import type { FiberSegment, FtthImportPreview, NapBox } from '../../../src/types';

const NAP_CSV_HEADERS = [
  'id',
  'name',
  'lat',
  'lng',
  'pon_port',
  'split_ratio',
  'fibers_total',
  'coverage_m',
] as const;

const SEGMENT_CSV_HEADERS = [
  'id',
  'name',
  'from_id',
  'to_id',
  'type',
  'thread_count',
  'coordinates',
] as const;

type CsvRow = Record<string, string>;

const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
};

export const parseCsvTable = (raw: string): CsvRow[] => {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    const row: CsvRow = { __row: String(index + 2) };
    headers.forEach((header, i) => {
      row[header] = values[i] ?? '';
    });
    return row;
  });
};

const parseCoordinatesField = (value: string): Array<[number, number]> => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((pair) => {
          if (!Array.isArray(pair) || pair.length < 2) return null;
          const lat = Number(pair[0]);
          const lng = Number(pair[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return [lat, lng] as [number, number];
        })
        .filter((p): p is [number, number] => p !== null);
    }
  } catch {
    /* semicolon-separated lat,lng pairs */
  }
  return trimmed
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [a, b] = chunk.split(',').map((v) => Number(v.trim()));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return [a, b] as [number, number];
    })
    .filter((p): p is [number, number] => p !== null);
};

const normalizeSegmentType = (value: string): FiberSegment['segmentType'] => {
  const v = value.trim().toLowerCase();
  if (v === 'distribution' || v === 'distribucion') return 'distribution';
  if (v === 'drop') return 'drop';
  if (v === 'splice' || v === 'empalme') return 'splice';
  return 'feeder';
};

const buildPorts = (fibersTotal: number): NapBox['ports'] =>
  Array.from({ length: fibersTotal }, (_, i) => ({
    num: i + 1,
    status: 'free' as const,
    client: '',
  }));

export const parseNapCsv = (raw: string): { naps: NapBox[]; errors: string[] } => {
  const rows = parseCsvTable(raw);
  const errors: string[] = [];
  const naps: NapBox[] = [];

  for (const row of rows) {
    const rowNum = row.__row || '?';
    const id = (row.id || row.nap_id || '').trim();
    const name = (row.name || '').trim();
    const latRaw = (row.lat ?? '').trim();
    const lngRaw = (row.lng ?? '').trim();
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!id || !name) {
      errors.push(`Fila ${rowNum}: id y name son obligatorios`);
      continue;
    }
    if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      errors.push(`Fila ${rowNum}: lat/lng inválidos para ${id}`);
      continue;
    }
    const fibersTotal = Math.max(1, Number(row.fibers_total || row.ports || 8) || 8);
    naps.push({
      id,
      name,
      lat,
      lng,
      ponPort: (row.pon_port || row.pon || '1/1').trim(),
      splitRatio: (row.split_ratio || '1:8').trim(),
      fibersTotal,
      fibersFree: fibersTotal,
      coverageMeters: Math.max(40, Number(row.coverage_m || row.coverage || 200) || 200),
      ports: buildPorts(fibersTotal),
    });
  }

  return { naps, errors };
};

export const parseSegmentCsv = (raw: string): { segments: FiberSegment[]; errors: string[] } => {
  const rows = parseCsvTable(raw);
  const errors: string[] = [];
  const segments: FiberSegment[] = [];

  for (const row of rows) {
    const rowNum = row.__row || '?';
    const id = (row.id || '').trim();
    const name = (row.name || '').trim();
    if (!id || !name) {
      errors.push(`Fila ${rowNum}: id y name son obligatorios en tramos`);
      continue;
    }
    const coordinates = parseCoordinatesField(row.coordinates || row.coords || '');
    segments.push({
      id,
      name,
      fromRef: (row.from_id || row.from_ref || '').trim() || undefined,
      toRef: (row.to_id || row.to_ref || '').trim() || undefined,
      fromLabel: (row.from_label || row.from_id || '').trim(),
      toLabel: (row.to_label || row.to_id || '').trim(),
      segmentType: normalizeSegmentType(row.type || row.segment_type || 'feeder'),
      threadCount: Math.max(1, Number(row.thread_count || row.threads || 12) || 12),
      coordinates,
      napId: (row.nap_id || row.to_id || '').trim() || undefined,
      ponPort: (row.pon_port || '').trim() || undefined,
      notes: (row.notes || '').trim() || undefined,
    });
  }

  return { segments, errors };
};

const isGeoJson = (parsed: unknown): parsed is { type: string; features?: unknown[] } =>
  Boolean(parsed && typeof parsed === 'object' && 'type' in (parsed as object));

export const parseGeoJsonImport = (raw: string): FtthImportPreview => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const naps: NapBox[] = [];
  const segments: FiberSegment[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { naps: [], segments: [], errors: ['GeoJSON inválido: no se pudo parsear JSON'], warnings };
  }

  if (!isGeoJson(parsed)) {
    return { naps: [], segments: [], errors: ['GeoJSON inválido: falta type'], warnings };
  }

  const features = Array.isArray(parsed.features) ? parsed.features : [parsed];
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue;
    const f = feature as {
      type?: string;
      geometry?: { type?: string; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const props = f.properties ?? {};
    const geom = f.geometry;
    if (!geom || !geom.type) continue;

    if (geom.type === 'Point' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
      const lng = Number(geom.coordinates[0]);
      const lat = Number(geom.coordinates[1]);
      const id = String(props.id || props.nap_id || `NAP-${naps.length + 1}`);
      const name = String(props.name || id);
      const fibersTotal = Math.max(1, Number(props.fibers_total ?? props.ports ?? 8) || 8);
      naps.push({
        id,
        name,
        lat,
        lng,
        ponPort: String(props.pon_port ?? props.pon ?? '1/1'),
        splitRatio: String(props.split_ratio ?? '1:8'),
        fibersTotal,
        fibersFree: fibersTotal,
        coverageMeters: Math.max(40, Number(props.coverage_m ?? props.coverage ?? 200) || 200),
        ports: buildPorts(fibersTotal),
      });
      continue;
    }

    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      const coordinates = geom.coordinates
        .map((pair) => {
          if (!Array.isArray(pair) || pair.length < 2) return null;
          const lng = Number(pair[0]);
          const lat = Number(pair[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return [lat, lng] as [number, number];
        })
        .filter((p): p is [number, number] => p !== null);

      const id = String(props.id || `SEG-${segments.length + 1}`);
      segments.push({
        id,
        name: String(props.name || id),
        fromRef: props.from_id ? String(props.from_id) : undefined,
        toRef: props.to_id ? String(props.to_id) : undefined,
        fromLabel: String(props.from_label ?? props.from_id ?? ''),
        toLabel: String(props.to_label ?? props.to_id ?? ''),
        segmentType: normalizeSegmentType(String(props.type ?? props.segment_type ?? 'feeder')),
        threadCount: Math.max(1, Number(props.thread_count ?? props.threads ?? 12) || 12),
        coordinates,
        napId: props.nap_id ? String(props.nap_id) : props.to_id ? String(props.to_id) : undefined,
        ponPort: props.pon_port ? String(props.pon_port) : undefined,
        notes: props.notes ? String(props.notes) : undefined,
      });
    }
  }

  if (naps.length === 0 && segments.length === 0) {
    warnings.push('GeoJSON sin features Point/LineString reconocibles');
  }

  return { naps, segments, errors, warnings };
};

export const previewFtthImport = (payload: {
  format: 'csv-naps' | 'csv-segments' | 'geojson' | 'mixed';
  napsCsv?: string;
  segmentsCsv?: string;
  geojson?: string;
}): FtthImportPreview => {
  const errors: string[] = [];
  const warnings: string[] = [];
  let naps: NapBox[] = [];
  let segments: FiberSegment[] = [];

  if (payload.format === 'csv-naps' || payload.format === 'mixed') {
    if (payload.napsCsv?.trim()) {
      const parsed = parseNapCsv(payload.napsCsv);
      naps = parsed.naps;
      errors.push(...parsed.errors);
    } else if (payload.format === 'csv-naps') {
      errors.push('CSV de NAPs vacío');
    }
  }

  if (payload.format === 'csv-segments' || payload.format === 'mixed') {
    if (payload.segmentsCsv?.trim()) {
      const parsed = parseSegmentCsv(payload.segmentsCsv);
      segments = parsed.segments;
      errors.push(...parsed.errors);
    } else if (payload.format === 'csv-segments') {
      errors.push('CSV de tramos vacío');
    }
  }

  if (payload.format === 'geojson') {
    if (!payload.geojson?.trim()) {
      errors.push('GeoJSON vacío');
    } else {
      const parsed = parseGeoJsonImport(payload.geojson);
      naps = parsed.naps;
      segments = parsed.segments;
      errors.push(...parsed.errors);
      warnings.push(...parsed.warnings);
    }
  }

  return { naps, segments, errors, warnings };
};

export const napCsvTemplate = (): string =>
  `${NAP_CSV_HEADERS.join(',')}\nNAP-01,Caja Centro,19.4285,-99.1655,1/1,1:8,8,250`;

export const segmentCsvTemplate = (): string =>
  `${SEGMENT_CSV_HEADERS.join(',')}\nSEG-01,Feeder Centro,OLT-1,NAP-01,feeder,12,"[[19.43,-99.17],[19.428,-99.165]]"`;
