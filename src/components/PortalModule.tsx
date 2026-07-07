import React, { useState } from 'react';
import { Globe, CreditCard, Ticket, Calendar } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';
import { Client } from '../types';

interface PortalModuleProps {
  clients: Client[];
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function PortalModule({ clients, getAuthHeaders }: PortalModuleProps) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadSummary = async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff(`/api/portal/${clientId}/summary`, { headers });
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const reportTicket = async () => {
    if (!clientId) return;
    const headers = await getAuthHeaders();
    await fetchWithRateLimitBackoff(`/api/portal/${clientId}/tickets`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Falla reportada desde portal', description: 'Autoservicio' }),
    });
    void loadSummary();
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-3xl mx-auto">
      <div className="text-center">
        <Globe className="w-12 h-12 text-indigo-400 mx-auto mb-2" />
        <h2 className="text-2xl font-bold text-white">Portal del Cliente</h2>
        <p className="text-slate-400 text-sm">Vista de autoservicio (staging — seleccionar cliente)</p>
      </div>

      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => void loadSummary()}
        disabled={loading}
        className="w-full py-3 bg-indigo-600 rounded-lg text-white font-medium"
      >
        {loading ? 'Cargando…' : 'Ver mi cuenta'}
      </button>

      {summary && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="text-white text-lg font-semibold">{summary.client?.name}</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-950 rounded-lg p-4">
              <CreditCard className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-slate-400 text-xs">Saldo pendiente</div>
              <div className="text-xl font-bold text-white">${summary.balance?.toFixed(2)}</div>
            </div>
            <div className="bg-slate-950 rounded-lg p-4">
              <Calendar className="w-5 h-5 text-amber-400 mb-2" />
              <div className="text-slate-400 text-xs">Próximo vencimiento</div>
              <div className="text-lg text-white">{summary.nextDue ?? '—'}</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void reportTicket()} className="flex-1 flex items-center justify-center gap-2 py-2 bg-rose-600/20 border border-rose-500/30 rounded-lg text-rose-300 text-sm">
              <Ticket className="w-4 h-4" /> Reportar falla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
