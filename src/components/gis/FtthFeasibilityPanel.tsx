import React from 'react';
import { Crosshair, Loader2, MapPin, Search, TriangleAlert, Zap } from 'lucide-react';
import type { FtthFeasibilityCandidate, FtthFeasibilityResult } from '../../types';

interface FtthFeasibilityPanelProps {
  prospect: { lat: number; lng: number } | null;
  result: FtthFeasibilityResult | null;
  loading: boolean;
  error: string | null;
  pickMode: boolean;
  maxDropMeters: number;
  onTogglePickMode: () => void;
  onProspectChange: (lat: number, lng: number) => void;
  onMaxDropChange: (meters: number) => void;
  onCheck: () => void;
  onClear: () => void;
}

const fmtCoord = (value: number) => value.toFixed(6);

const CandidateRow: React.FC<{ candidate: FtthFeasibilityCandidate; best: boolean }> = ({
  candidate,
  best,
}) => {
  return (
    <div
      className={`rounded-xl border px-3 py-2 space-y-1 ${
        best
          ? 'border-emerald-700/60 bg-emerald-950/40'
          : candidate.hasFreePort
            ? 'border-slate-800 bg-slate-900/50'
            : 'border-rose-900/50 bg-rose-950/20'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-slate-200 truncate">{candidate.napName}</span>
        <span className="text-[10px] text-slate-400 shrink-0">{candidate.distanceMeters} m</span>
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className={candidate.hasFreePort ? 'text-emerald-400' : 'text-rose-400'}>
          {candidate.hasFreePort
            ? `${candidate.freePorts}/${candidate.totalPorts} puertos libres`
            : 'saturada'}
        </span>
        <span className="text-slate-500">
          {candidate.splitRatio}
          {candidate.ponPort ? ` · ${candidate.ponPort}` : ''}
        </span>
      </div>
    </div>
  );
};

/**
 * Widget de preventa: valida factibilidad FTTH en una coordenada antes de
 * vender el contrato. Marca el prospecto en el mapa y consulta la CTO/NAP
 * más cercana con puerto libre.
 */
export default function FtthFeasibilityPanel({
  prospect,
  result,
  loading,
  error,
  pickMode,
  maxDropMeters,
  onTogglePickMode,
  onProspectChange,
  onMaxDropChange,
  onCheck,
  onClear,
}: FtthFeasibilityPanelProps) {
  const best = result?.best ?? null;

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-900 pb-3">
        <h3 className="text-xs font-bold text-slate-300 font-mono uppercase flex items-center gap-2">
          <Search className="w-4 h-4 text-emerald-400" />
          Factibilidad de preventa
        </h3>
        <button
          type="button"
          onClick={onTogglePickMode}
          className={`text-[10px] font-mono px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1.5 ${
            pickMode
              ? 'border-emerald-600 bg-emerald-900/40 text-emerald-300'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Crosshair className="w-3 h-3" />
          {pickMode ? 'Click en el mapa' : 'Marcar en mapa'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
        <label className="space-y-1">
          <span className="text-[9px] uppercase text-slate-500 block">Latitud</span>
          <input
            type="number"
            step="0.000001"
            value={prospect ? prospect.lat : ''}
            onChange={(e) => onProspectChange(Number(e.target.value), prospect?.lng ?? 0)}
            placeholder="19.428500"
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 focus:border-emerald-700 focus:outline-none"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[9px] uppercase text-slate-500 block">Longitud</span>
          <input
            type="number"
            step="0.000001"
            value={prospect ? prospect.lng : ''}
            onChange={(e) => onProspectChange(prospect?.lat ?? 0, Number(e.target.value))}
            placeholder="-99.165500"
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 focus:border-emerald-700 focus:outline-none"
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[9px] uppercase text-slate-500 block">Drop máximo (m)</span>
          <input
            type="number"
            min={10}
            step={10}
            value={maxDropMeters}
            onChange={(e) => onMaxDropChange(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 focus:border-emerald-700 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCheck}
          disabled={!prospect || loading}
          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-600 text-white text-[11px] font-mono font-bold rounded-lg px-3 py-2 transition-colors"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          Consultar cobertura
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] font-mono text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg px-3 py-2"
        >
          Limpiar
        </button>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-[10px] font-mono text-rose-400 bg-rose-950/30 border border-rose-900/50 rounded-lg px-3 py-2">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          {error}
        </p>
      )}

      {result && !error && (
        <div className="space-y-3">
          <div
            className={`rounded-xl border px-3 py-2.5 font-mono ${
              result.eligible
                ? 'border-emerald-700/60 bg-emerald-950/40'
                : 'border-amber-800/60 bg-amber-950/30'
            }`}
          >
            <p
              className={`text-xs font-bold ${result.eligible ? 'text-emerald-300' : 'text-amber-300'}`}
            >
              {result.eligible ? 'Cobertura disponible' : 'Sin cobertura'}
            </p>
            {best ? (
              <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                {best.napName} · {best.freePorts} puerto{best.freePorts === 1 ? '' : 's'} libre
                {best.freePorts === 1 ? '' : 's'} · drop {best.distanceMeters} m
              </p>
            ) : (
              <p className="text-[11px] text-slate-400 mt-1">{result.message}</p>
            )}
            <p className="text-[9px] text-slate-500 mt-1.5">
              Radio de búsqueda {result.searchRadiusMeters} m · distancia en línea recta, el
              tendido real es mayor
            </p>
          </div>

          {result.candidates.length > 0 && (
            <div className="space-y-2 max-h-[220px] overflow-y-auto font-mono text-xs">
              {result.candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.napId}
                  candidate={candidate}
                  best={candidate.napId === best?.napId}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {prospect && (
        <p className="flex items-center gap-1.5 text-[9px] font-mono text-slate-600 border-t border-slate-900 pt-2">
          <MapPin className="w-3 h-3" />
          Prospecto en {fmtCoord(prospect.lat)}, {fmtCoord(prospect.lng)}
        </p>
      )}
    </div>
  );
}
