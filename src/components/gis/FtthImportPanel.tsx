import React, { useState } from 'react';
import {
  Upload,
  FileJson,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Download,
} from 'lucide-react';
import type { FiberSegment, FtthImportPreview, FtthImportResult, NapBox } from '../../types';
import {
  NAP_CSV_TEMPLATE,
  SEGMENT_CSV_TEMPLATE,
  downloadTextFile,
  napsToCsv,
  segmentsToCsv,
  toFtthGeoJson,
} from '../../lib/ftthExport';

type ImportFormat = 'csv-naps' | 'csv-segments' | 'geojson' | 'mixed';

interface FtthImportPanelProps {
  naps?: NapBox[];
  segments?: FiberSegment[];
  onImported?: () => void;
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
}

async function postJson<T>(url: string, body: unknown, authHeaders: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: string; errors?: string[] }).error ||
      (data as { errors?: string[] }).errors?.join('; ') ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Importador/exportador CSV·GeoJSON pensado para el WISP (todo desde la UI). */
export default function FtthImportPanel({
  naps = [],
  segments = [],
  onImported,
  getAuthHeaders,
}: FtthImportPanelProps) {
  const [format, setFormat] = useState<ImportFormat>('mixed');
  const [napsCsv, setNapsCsv] = useState('');
  const [segmentsCsv, setSegmentsCsv] = useState('');
  const [geojson, setGeojson] = useState('');
  const [preview, setPreview] = useState<FtthImportPreview | null>(null);
  const [result, setResult] = useState<FtthImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const payload = () => ({
    format,
    napsCsv: format === 'csv-naps' || format === 'mixed' ? napsCsv : undefined,
    segmentsCsv: format === 'csv-segments' || format === 'mixed' ? segmentsCsv : undefined,
    geojson: format === 'geojson' ? geojson : undefined,
  });

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const authHeaders = await Promise.resolve(getAuthHeaders?.() ?? {});
      const data = await postJson<FtthImportPreview>('/api/ftth/import/preview', payload(), authHeaders);
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al previsualizar');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const authHeaders = await Promise.resolve(getAuthHeaders?.() ?? {});
      const data = await postJson<FtthImportResult>('/api/ftth/import', payload(), authHeaders);
      setResult(data);
      setPreview(null);
      onImported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al importar');
    } finally {
      setBusy(false);
    }
  };

  const loadFile = async (file: File, target: 'naps' | 'segments' | 'geojson') => {
    const text = await file.text();
    if (target === 'naps') setNapsCsv(text);
    else if (target === 'segments') setSegmentsCsv(text);
    else setGeojson(text);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const exportReal = (kind: 'naps-csv' | 'segments-csv' | 'geojson') => {
    setExportNote(null);
    setError(null);
    if (kind === 'naps-csv') {
      if (naps.length === 0) {
        setError('No hay NAPs registradas para exportar. Importa o créalas primero.');
        return;
      }
      downloadTextFile('naps.csv', napsToCsv(naps), 'text/csv;charset=utf-8');
      setExportNote(`Descargado naps.csv (${naps.length} NAPs reales).`);
      return;
    }
    if (kind === 'segments-csv') {
      if (segments.length === 0) {
        setError('No hay tramos registrados para exportar.');
        return;
      }
      downloadTextFile('segments.csv', segmentsToCsv(segments), 'text/csv;charset=utf-8');
      setExportNote(`Descargado segments.csv (${segments.length} tramos reales).`);
      return;
    }
    if (naps.length === 0 && segments.length === 0) {
      setError('Sin NAPs ni tramos para armar GeoJSON.');
      return;
    }
    const geo = JSON.stringify(toFtthGeoJson(naps, segments), null, 2) + '\n';
    downloadTextFile('ftth.geojson', geo, 'application/geo+json;charset=utf-8');
    setExportNote(`Descargado ftth.geojson (${naps.length} NAPs · ${segments.length} tramos).`);
  };

  const loadTemplate = (kind: 'naps' | 'segments') => {
    if (kind === 'naps') {
      setNapsCsv(NAP_CSV_TEMPLATE.trim() + '\n');
      setFormat((f) => (f === 'geojson' ? 'mixed' : f));
    } else {
      setSegmentsCsv(SEGMENT_CSV_TEMPLATE.trim() + '\n');
      setFormat((f) => (f === 'geojson' ? 'mixed' : f));
    }
    setExportNote(kind === 'naps' ? 'Plantilla NAPs cargada en el editor.' : 'Plantilla tramos cargada en el editor.');
  };

  return (
    <div
      id="ftth-import-panel"
      className="bg-slate-950 border border-violet-900/30 rounded-3xl p-5 space-y-4"
    >
      <div className="border-b border-slate-900 pb-3">
        <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center gap-2">
          <Upload className="w-4 h-4 text-violet-400" />
          Importar / exportar NAPs y tramos
        </h3>
        <p className="text-[11px] text-slate-500 font-mono mt-1 leading-snug">
          Todo desde esta pantalla: descarga plantillas, exporta tu planta real (CSV/GeoJSON) o importa
          archivos. No necesitas acceso al servidor.
        </p>
      </div>

      {/* Exportación pensada para el WISP */}
      <div
        id="ftth-export-actions"
        className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2"
      >
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          Descargar (sin VPS)
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            id="ftth-export-naps-csv"
            onClick={() => exportReal('naps-csv')}
            className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] font-mono text-emerald-200 hover:bg-emerald-900/40"
          >
            Mis NAPs (CSV)
          </button>
          <button
            type="button"
            id="ftth-export-segments-csv"
            onClick={() => exportReal('segments-csv')}
            className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] font-mono text-emerald-200 hover:bg-emerald-900/40"
          >
            Mis tramos (CSV)
          </button>
          <button
            type="button"
            id="ftth-export-geojson"
            onClick={() => exportReal('geojson')}
            className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-1.5 text-[11px] font-mono text-emerald-200 hover:bg-emerald-900/40"
          >
            Planta GeoJSON
          </button>
          <button
            type="button"
            id="ftth-download-nap-template"
            onClick={() => {
              downloadTextFile('plantilla-naps.csv', NAP_CSV_TEMPLATE, 'text/csv;charset=utf-8');
              setExportNote('Descargada plantilla-naps.csv');
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-mono text-slate-300 hover:bg-slate-800"
          >
            Plantilla NAPs
          </button>
          <button
            type="button"
            id="ftth-download-segment-template"
            onClick={() => {
              downloadTextFile('plantilla-tramos.csv', SEGMENT_CSV_TEMPLATE, 'text/csv;charset=utf-8');
              setExportNote('Descargada plantilla-tramos.csv');
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-mono text-slate-300 hover:bg-slate-800"
          >
            Plantilla tramos
          </button>
          <button
            type="button"
            id="ftth-load-nap-template"
            onClick={() => loadTemplate('naps')}
            className="rounded-lg border border-violet-800/50 px-3 py-1.5 text-[11px] font-mono text-violet-300 hover:bg-violet-950/40"
          >
            Cargar plantilla NAPs al editor
          </button>
          <button
            type="button"
            id="ftth-load-segment-template"
            onClick={() => loadTemplate('segments')}
            className="rounded-lg border border-violet-800/50 px-3 py-1.5 text-[11px] font-mono text-violet-300 hover:bg-violet-950/40"
          >
            Cargar plantilla tramos al editor
          </button>
        </div>
        <p className="text-[10px] text-slate-600 font-mono">
          Inventario actual: {naps.length} NAPs · {segments.length} tramos
        </p>
        {exportNote && (
          <p className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {exportNote}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['mixed', 'CSV mixto'],
            ['csv-naps', 'Solo NAPs'],
            ['csv-segments', 'Solo tramos'],
            ['geojson', 'GeoJSON'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFormat(value)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-mono border transition ${
              format === value
                ? 'bg-violet-900/40 border-violet-600 text-violet-200'
                : 'border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(format === 'csv-naps' || format === 'mixed') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1">
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV NAPs
            </span>
            <label className="text-[10px] text-violet-400 cursor-pointer hover:underline">
              Subir archivo
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f, 'naps');
                }}
              />
            </label>
          </div>
          <textarea
            value={napsCsv}
            onChange={(e) => setNapsCsv(e.target.value)}
            placeholder={NAP_CSV_TEMPLATE}
            rows={4}
            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-mono text-slate-200"
          />
        </div>
      )}

      {(format === 'csv-segments' || format === 'mixed') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1">
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV tramos
            </span>
            <label className="text-[10px] text-violet-400 cursor-pointer hover:underline">
              Subir archivo
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f, 'segments');
                }}
              />
            </label>
          </div>
          <textarea
            value={segmentsCsv}
            onChange={(e) => setSegmentsCsv(e.target.value)}
            placeholder={SEGMENT_CSV_TEMPLATE}
            rows={4}
            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-mono text-slate-200"
          />
        </div>
      )}

      {format === 'geojson' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono flex items-center gap-1">
              <FileJson className="w-3.5 h-3.5" /> GeoJSON
            </span>
            <label className="text-[10px] text-violet-400 cursor-pointer hover:underline">
              Subir archivo
              <input
                type="file"
                accept=".json,.geojson,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f, 'geojson');
                }}
              />
            </label>
          </div>
          <textarea
            value={geojson}
            onChange={(e) => setGeojson(e.target.value)}
            placeholder='{"type":"FeatureCollection","features":[...]}'
            rows={6}
            className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-mono text-slate-200"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          id="ftth-import-preview"
          disabled={busy}
          onClick={() => void runPreview()}
          className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          Previsualizar
        </button>
        <button
          type="button"
          id="ftth-import-run"
          disabled={busy}
          onClick={() => void runImport()}
          className="rounded-xl bg-violet-700 hover:bg-violet-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          Importar
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-rose-400 font-mono flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}

      {preview && (
        <div id="ftth-import-preview-result" className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-2 font-mono text-[11px]">
          <p className="text-slate-300">
            Vista previa: <strong>{preview.naps.length}</strong> NAPs ·{' '}
            <strong>{preview.segments.length}</strong> tramos
          </p>
          {preview.errors.length > 0 && (
            <ul className="text-rose-400 space-y-0.5">
              {preview.errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          )}
          {preview.warnings.length > 0 && (
            <ul className="text-amber-400 space-y-0.5">
              {preview.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <p className="text-[11px] text-emerald-400 font-mono flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Importado: {result.napsCreated} NAPs nuevas, {result.napsUpdated} actualizadas ·{' '}
          {result.segmentsCreated} tramos nuevos, {result.segmentsUpdated} actualizados
        </p>
      )}
    </div>
  );
}
