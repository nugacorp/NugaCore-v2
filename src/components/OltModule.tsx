import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthorizedApi } from '../lib/apiClient';
import { Server, Plus, Trash2, Terminal, RefreshCw, Copy, Check, AlertTriangle } from 'lucide-react';

// ====================================================================
// Gestión de OLTs + configuración inicial recomendada.
//
// Self-contained (getAuthHeaders). El WISP elige marca/modelo → ve la config
// sugerida (rendimiento/estabilidad) y genera un script de arranque + snippet
// MikroTik para alcanzar la OLT por WireGuard. Persiste en /api/olts.
// ====================================================================

interface CatalogEntry { brand: string; models: string[]; defaultPonType: string }
interface Setting { key: string; value: string; reason: string }
interface Recommendation {
  summary: string; rationale: string[]; settings: Setting[];
  capacity: { ponPorts: number; onusPerPonRecommended: number; recommendedSplit: string };
  cliFlavor: string; ponType: string;
}
interface Olt {
  id: string; name: string; brand: string; model: string; ponType: string;
  managementIp: string; managementVlan?: number; provisioningStatus: string;
  towerId?: string; mikrotikRouterId?: string;
}
interface ScriptResult {
  oltScript: string; mikrotikSnippet: string; sshUsername: string;
  sshPasswordOnce: string; warnings: string[];
}

interface Props { getAuthHeaders: () => Promise<Record<string, string>> | Record<string, string> }

const CopyBtn: React.FC<{ text: string }> = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {done ? 'Copiado' : 'Copiar'}
    </button>
  );
};

const OltModule: React.FC<Props> = ({ getAuthHeaders }) => {
  const api = useMemo(() => createAuthorizedApi(getAuthHeaders), [getAuthHeaders]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [olts, setOlts] = useState<Olt[]>([]);
  const [form, setForm] = useState({
    name: '', brand: '', model: '', managementIp: '', managementVlan: '',
    towerId: '', mikrotikRouterId: '',
  });
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [script, setScript] = useState<ScriptResult | null>(null);
  const [reach, setReach] = useState({ mikrotikWgInterface: '', mikrotikLanInterface: '', mikrotikLanIp: '' });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cat, list] = await Promise.all([
        api.get<CatalogEntry[]>('/api/olts/catalog'),
        api.get<Olt[]>('/api/olts'),
      ]);
      setCatalog(cat); setOlts(list);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error cargando OLTs'); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const models = useMemo(
    () => catalog.find((c) => c.brand === form.brand)?.models ?? [],
    [catalog, form.brand],
  );

  const suggest = async () => {
    setError(null); setRec(null);
    if (!form.brand || !form.model) { setError('Elige marca y modelo'); return; }
    try {
      const q = new URLSearchParams({ brand: form.brand, model: form.model });
      if (form.managementVlan) q.set('mgmtVlan', form.managementVlan);
      setRec(await api.get<Recommendation>(`/api/olts/suggest?${q.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al sugerir'); }
  };

  const create = async () => {
    setError(null); setLoading(true);
    try {
      await api.post('/api/olts', {
        name: form.name, brand: form.brand, model: form.model,
        managementIp: form.managementIp,
        managementVlan: form.managementVlan ? Number(form.managementVlan) : undefined,
        towerId: form.towerId || undefined,
        mikrotikRouterId: form.mikrotikRouterId || undefined,
      });
      setForm({ name: '', brand: '', model: '', managementIp: '', managementVlan: '', towerId: '', mikrotikRouterId: '' });
      setRec(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al crear OLT'); }
    finally { setLoading(false); }
  };

  const genScript = async (id: string) => {
    setError(null); setScript(null);
    try {
      setScript(await api.post<ScriptResult>(`/api/olts/${id}/script`, reach));
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al generar script'); }
  };

  const remove = async (id: string) => {
    try { await api.delete(`/api/olts/${id}`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al eliminar'); }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto text-slate-100">
      <div className="flex items-center gap-3 mb-6">
        <Server className="w-7 h-7 text-indigo-400" />
        <div>
          <h1 className="text-2xl font-bold">OLTs</h1>
          <p className="text-slate-400 text-sm">Alta de OLT + configuración inicial recomendada y script de arranque.</p>
        </div>
        <button onClick={() => void load()} className="ml-auto inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600">
          <RefreshCw className="w-4 h-4" /> Actualizar
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm bg-red-950/60 border border-red-800 text-red-200 rounded px-3 py-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Alta */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
        <h2 className="font-semibold mb-3">Agregar OLT</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
          <select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value, model: '' })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
            <option value="">Marca…</option>
            {catalog.map((c) => <option key={c.brand} value={c.brand}>{c.brand}</option>)}
          </select>
          <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} disabled={!form.brand}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm disabled:opacity-50">
            <option value="">Modelo…</option>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input placeholder="IP de gestión (LAN torre)" value={form.managementIp} onChange={(e) => setForm({ ...form, managementIp: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
          <input placeholder="VLAN de gestión (opcional)" value={form.managementVlan} onChange={(e) => setForm({ ...form, managementVlan: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
          <input placeholder="MikroTik ID (peer WG, opcional)" value={form.mikrotikRouterId} onChange={(e) => setForm({ ...form, mikrotikRouterId: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => void suggest()} className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded bg-slate-700 hover:bg-slate-600">
            Ver configuración sugerida
          </button>
          <button onClick={() => void create()} disabled={loading || !form.name || !form.brand || !form.model || !form.managementIp}
            className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50">
            <Plus className="w-4 h-4" /> Agregar
          </button>
        </div>

        {rec && (
          <div className="mt-4 bg-slate-950/60 border border-slate-800 rounded p-4">
            <p className="text-sm text-indigo-300 mb-2">{rec.summary}</p>
            <p className="text-xs text-slate-400 mb-2">
              Split recomendado: <span className="text-slate-200">{rec.capacity.recommendedSplit}</span> ·
              ~{rec.capacity.onusPerPonRecommended} ONUs/PON · {rec.capacity.ponPorts} puertos PON · CLI {rec.cliFlavor}
            </p>
            <ul className="text-xs text-slate-300 list-disc pl-5 space-y-1 mb-3">
              {rec.rationale.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <div className="space-y-1">
              {rec.settings.map((s) => (
                <div key={s.key} className="text-xs grid grid-cols-1 md:grid-cols-3 gap-1 border-t border-slate-800 pt-1">
                  <span className="text-slate-200 font-mono">{s.key}</span>
                  <span className="text-emerald-300">{s.value}</span>
                  <span className="text-slate-400">{s.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Alcanzabilidad para el script */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
        <h2 className="font-semibold mb-1">Alcanzabilidad (para el script MikroTik)</h2>
        <p className="text-xs text-slate-400 mb-3">WG server (app) → MikroTik (peer WireGuard) → LAN torre → OLT.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input placeholder="Interfaz WG del MikroTik (p.ej. wg-nuga)" value={reach.mikrotikWgInterface} onChange={(e) => setReach({ ...reach, mikrotikWgInterface: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
          <input placeholder="Interfaz LAN del MikroTik (p.ej. bridge-lan)" value={reach.mikrotikLanInterface} onChange={(e) => setReach({ ...reach, mikrotikLanInterface: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
          <input placeholder="IP LAN del MikroTik (gateway de la OLT)" value={reach.mikrotikLanIp} onChange={(e) => setReach({ ...reach, mikrotikLanIp: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Listado */}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 mb-6">
        <h2 className="font-semibold mb-3">OLTs registradas ({olts.length})</h2>
        {olts.length === 0 && <p className="text-sm text-slate-500">Sin OLTs aún.</p>}
        <div className="space-y-2">
          {olts.map((o) => (
            <div key={o.id} className="flex items-center gap-3 bg-slate-950/50 border border-slate-800 rounded px-3 py-2 text-sm">
              <Server className="w-4 h-4 text-indigo-400" />
              <div className="flex-1">
                <div className="font-medium">{o.name} <span className="text-slate-500">· {o.brand} {o.model}</span></div>
                <div className="text-xs text-slate-400">{o.managementIp}{o.managementVlan ? ` · VLAN ${o.managementVlan}` : ''} · {o.provisioningStatus}</div>
              </div>
              <button onClick={() => void genScript(o.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500">
                <Terminal className="w-3 h-3" /> Script
              </button>
              <button onClick={() => void remove(o.id)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-red-200">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Script generado */}
      {script && (
        <div className="bg-slate-900 border border-indigo-900 rounded-lg p-5 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="w-5 h-5 text-indigo-400" />
            <h2 className="font-semibold">Script de arranque</h2>
          </div>
          <div className="mb-3 flex items-start gap-2 text-xs bg-amber-950/50 border border-amber-800 text-amber-200 rounded px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div>Usuario SSH: <span className="font-mono text-amber-100">{script.sshUsername}</span> · Password (se muestra una sola vez): <span className="font-mono text-amber-100">{script.sshPasswordOnce}</span></div>
              <ul className="list-disc pl-5 mt-1">{script.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          </div>
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-slate-400">OLT — CLI de arranque</span><CopyBtn text={script.oltScript} /></div>
            <pre className="text-xs bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto whitespace-pre text-slate-200">{script.oltScript}</pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1"><span className="text-xs text-slate-400">MikroTik — snippet de alcanzabilidad (.rsc)</span><CopyBtn text={script.mikrotikSnippet} /></div>
            <pre className="text-xs bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto whitespace-pre text-slate-200">{script.mikrotikSnippet}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default OltModule;
