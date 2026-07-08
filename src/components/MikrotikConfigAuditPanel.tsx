import React, { useCallback, useEffect, useState } from 'react';
import { Archive, GitCompare, Eye, RefreshCw } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';

interface MikrotikConfigAuditPanelProps {
  routerId: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function MikrotikConfigAuditPanel({ routerId, getAuthHeaders }: MikrotikConfigAuditPanelProps) {
  const [backups, setBackups] = useState<any[]>([]);
  const [diff, setDiff] = useState<any | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [backupContent, setBackupContent] = useState('/interface print\n/queue simple print');
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff(`/api/mikrotik/${routerId}/backups`, { headers });
      if (res.ok) setBackups(await res.json());
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, routerId]);

  useEffect(() => { void load(); }, [load]);

  const createBackup = async () => {
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff(`/api/mikrotik/${routerId}/backups`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: backupContent, backupType: 'export' }),
    });
    if (res.ok) void load();
  };

  const runDiff = async () => {
    if (!diffA || !diffB) return;
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff(`/api/mikrotik/backups/diff?a=${encodeURIComponent(diffA)}&b=${encodeURIComponent(diffB)}`, { headers });
    if (res.ok) setDiff(await res.json());
  };

  const runPreview = async () => {
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff(`/api/mikrotik/${routerId}/operations/preview`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'queue_suspend' }),
    });
    if (res.ok) setPreview(await res.json());
  };

  return (
    <section className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Archive className="w-4 h-4 text-indigo-400" /> Config Audit (OLA 2 — gated dry-run)
        </h3>
        <button type="button" onClick={() => void load()} className="text-xs text-slate-400 flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-slate-400">Backup export (contenido simulado)</label>
          <textarea
            value={backupContent}
            onChange={(e) => setBackupContent(e.target.value)}
            rows={4}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs font-mono text-slate-200"
          />
          <button type="button" onClick={() => void createBackup()} className="w-full py-2 bg-indigo-600 rounded-lg text-white text-xs">
            Guardar backup dry-run
          </button>
          <ul className="text-xs text-slate-500 space-y-1 max-h-24 overflow-auto">
            {backups.map((b) => (
              <li key={b.id} className="font-mono">{b.id} · {b.sizeBytes}B</li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-400 flex items-center gap-1"><GitCompare className="w-3 h-3" /> Diff entre backups</label>
          <select value={diffA} onChange={(e) => setDiffA(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white">
            <option value="">Backup A</option>
            {backups.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          <select value={diffB} onChange={(e) => setDiffB(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white">
            <option value="">Backup B</option>
            {backups.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
          </select>
          <button type="button" onClick={() => void runDiff()} className="w-full py-2 bg-slate-800 rounded-lg text-slate-200 text-xs">Comparar</button>
          {diff && (
            <pre className="text-[10px] text-slate-400 bg-slate-900 p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(diff, null, 2)}
            </pre>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-xs text-slate-400 flex items-center gap-1"><Eye className="w-3 h-3" /> Preview operación</label>
          <button type="button" onClick={() => void runPreview()} className="w-full py-2 bg-amber-600/20 border border-amber-500/30 rounded-lg text-amber-200 text-xs">
            Preview queue_suspend (gated)
          </button>
          {preview && (
            <pre className="text-[10px] text-slate-400 bg-slate-900 p-2 rounded overflow-auto max-h-40">
              {JSON.stringify(preview.preview, null, 2)}
            </pre>
          )}
          <p className="text-[10px] text-slate-500">Live bloqueado hasta PROD-7+. MIKROTIK_WORKER_LIVE=false.</p>
        </div>
      </div>
    </section>
  );
}
