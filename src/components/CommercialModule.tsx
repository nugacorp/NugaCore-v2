import React, { useCallback, useEffect, useState } from 'react';
import { Users, FileText, Calendar, TrendingUp, Plus, RefreshCw } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';

type Tab = 'pipeline' | 'prospects' | 'quotes' | 'appointments';

interface CommercialModuleProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function CommercialModule({ getAuthHeaders }: CommercialModuleProps) {
  const [tab, setTab] = useState<Tab>('pipeline');
  const [pipeline, setPipeline] = useState<{ stages: { stage: string; count: number }[]; totalProspects: number } | null>(null);
  const [prospects, setProspects] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const [pRes, prRes, qRes, aRes] = await Promise.all([
        fetchWithRateLimitBackoff('/api/commercial/pipeline', { headers }),
        fetchWithRateLimitBackoff('/api/commercial/prospects', { headers }),
        fetchWithRateLimitBackoff('/api/commercial/quotes', { headers }),
        fetchWithRateLimitBackoff('/api/commercial/appointments', { headers }),
      ]);
      if (pRes.ok) setPipeline(await pRes.json());
      if (prRes.ok) setProspects(await prRes.json());
      if (qRes.ok) setQuotes(await qRes.json());
      if (aRes.ok) setAppointments(await aRes.json());
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const createProspect = async () => {
    if (!newName.trim()) return;
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff('/api/commercial/prospects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), stage: 'lead' }),
    });
    if (res.ok) {
      setNewName('');
      void load();
    }
  };

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: 'pipeline', label: 'Pipeline', icon: TrendingUp },
    { id: 'prospects', label: 'Prospectos', icon: Users },
    { id: 'quotes', label: 'Cotizaciones', icon: FileText },
    { id: 'appointments', label: 'Agenda', icon: Calendar },
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">CRM Comercial WISP</h2>
          <p className="text-slate-400 text-sm">Lead → visita → cotización → instalación</p>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'}`}
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'pipeline' && pipeline && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {pipeline.stages.map((s) => (
            <div key={s.stage} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-indigo-400">{s.count}</div>
              <div className="text-xs text-slate-400 uppercase mt-1">{s.stage}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'prospects' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre prospecto"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
            />
            <button type="button" onClick={() => void createProspect()} className="flex items-center gap-1 px-4 py-2 bg-emerald-600 rounded-lg text-white text-sm">
              <Plus className="w-4 h-4" /> Alta
            </button>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-950 text-slate-400">
                <tr><th className="text-left p-3">Nombre</th><th className="text-left p-3">Etapa</th><th className="text-left p-3">Ciudad</th></tr>
              </thead>
              <tbody>
                {prospects.map((p) => (
                  <tr key={p.id} className="border-t border-slate-800">
                    <td className="p-3 text-white">{p.name}</td>
                    <td className="p-3 text-indigo-300">{p.stage}</td>
                    <td className="p-3 text-slate-400">{p.city ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'quotes' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-950 text-slate-400">
              <tr><th className="text-left p-3">Título</th><th className="text-left p-3">Monto</th><th className="text-left p-3">Estado</th></tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-t border-slate-800">
                  <td className="p-3 text-white">{q.title}</td>
                  <td className="p-3 text-emerald-400">${(q.amountCents / 100).toFixed(2)}</td>
                  <td className="p-3 text-slate-400">{q.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'appointments' && (
        <div className="space-y-2">
          {appointments.map((a) => (
            <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-lg p-4 flex justify-between">
              <div>
                <div className="text-white font-medium">{a.title}</div>
                <div className="text-slate-400 text-sm">{a.scheduledAt} · {a.appointmentType}</div>
              </div>
              <span className="text-indigo-300 text-sm">{a.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
