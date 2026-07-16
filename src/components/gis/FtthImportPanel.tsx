import React, { useState } from 'react';
import { Upload, FileJson, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FtthImportPreview, FtthImportResult } from '../../types';

type ImportFormat = 'csv-naps' | 'csv-segments' | 'geojson' | 'mixed';

interface FtthImportPanelProps {
  onImported?: () => void;
}

const NAP_TEMPLATE = `id,name,lat,lng,pon_port,split_ratio,fibers_total,coverage_m
NAP-01,Caja Centro,19.4285,-99.1655,1/1,1:8,8,250`;

const SEGMENT_TEMPLATE = `id,name,from_id,to_id,type,thread_count,coordinates
SEG-01,Feeder Centro,OLT-1,NAP-01,feeder,12,"[[19.43,-99.17],[19.428,-99.165]]"`;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

/** Importador CSV / GeoJSON de NAPs y tramos de fibra. */
export default function FtthImportPanel({ onImported }: FtthImportPanelProps) {
  const [format, setFormat] = useState<ImportFormat>('mixed');
  const [napsCsv, setNapsCsv] = useState('');
  const [segmentsCsv, setSegmentsCsv] = useState('');
  const [geojson, setGeojson] = useState('');
  const [preview, setPreview] = useState<FtthImportPreview | null>(null);
  const [result, setResult] = useState<FtthImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const data = await postJson<FtthImportPreview>('/api/ftth/import/preview', payload());
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
      const data = await postJson<FtthImportResult>('/api/ftth/import', payload());
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

  return (
    <div
      id="ftth-import-panel"
      className="bg-slate-950 border border-violet-900/30 rounded-3xl p-5 space-y-4"
    >
      <div className="border-b border-slate-900 pb-3">
        <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center gap-2">
          <Upload className="w-4 h-4 text-violet-400" />
          Importar NAPs y tramos
        </h3>
        <p className="text-[11px] text-slate-500 font-mono mt-1 leading-snug">
          CSV de cajas NAP, CSV de tramos con coordenadas, o GeoJSON (Point + LineString).
          Los datos se persisten en la API FTTH.
        </p>
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
            placeholder={NAP_TEMPLATE}
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
            placeholder={SEGMENT_TEMPLATE}
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
