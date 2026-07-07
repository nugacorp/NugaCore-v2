import React, { useState, useEffect } from 'react';
import { Globe, CreditCard, Ticket, Calendar, Receipt, HandCoins } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';
import { Client } from '../types';

interface PortalModuleProps {
  clients: Client[];
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function PortalModule({ clients, getAuthHeaders }: PortalModuleProps) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [summary, setSummary] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [promiseDate, setPromiseDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  });
  const [promiseAmount, setPromiseAmount] = useState('');

  const loadAll = async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const [sumRes, invRes, tktRes] = await Promise.all([
        fetchWithRateLimitBackoff(`/api/portal/${clientId}/summary`, { headers }),
        fetchWithRateLimitBackoff(`/api/portal/${clientId}/invoices`, { headers }),
        fetchWithRateLimitBackoff(`/api/portal/${clientId}/tickets`, { headers }),
      ]);
      if (sumRes.ok) setSummary(await sumRes.json());
      if (invRes.ok) setInvoices(await invRes.json());
      if (tktRes.ok) setTickets(await tktRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clientId) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const reportTicket = async () => {
    if (!clientId) return;
    const headers = await getAuthHeaders();
    await fetchWithRateLimitBackoff(`/api/portal/${clientId}/tickets`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Falla reportada desde portal', description: 'Autoservicio' }),
    });
    void loadAll();
  };

  const submitPromise = async () => {
    if (!clientId || !promiseAmount) return;
    const headers = await getAuthHeaders();
    await fetchWithRateLimitBackoff(`/api/portal/${clientId}/payment-promise`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ promisedDate: promiseDate, amount: Number(promiseAmount) }),
    });
    setPromiseAmount('');
    void loadAll();
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-3xl mx-auto">
      <div className="text-center">
        <Globe className="w-12 h-12 text-indigo-400 mx-auto mb-2" />
        <h2 className="text-2xl font-bold text-white">Portal del Cliente</h2>
        <p className="text-slate-400 text-sm">Autoservicio (staging — selector de cliente)</p>
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
        onClick={() => void loadAll()}
        disabled={loading}
        className="w-full py-3 bg-indigo-600 rounded-lg text-white font-medium"
      >
        {loading ? 'Cargando…' : 'Actualizar mi cuenta'}
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

          <section>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-2"><Receipt className="w-4 h-4" /> Mis facturas</h3>
            {invoices.length === 0 ? (
              <p className="text-xs text-slate-500">Sin facturas.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {invoices.slice(0, 8).map((inv) => (
                  <li key={inv.id} className="flex justify-between border border-slate-800 rounded-lg px-3 py-2">
                    <span>{inv.id}</span>
                    <span className={inv.status === 'paid' ? 'text-emerald-400' : 'text-amber-300'}>${inv.amount} · {inv.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-2"><Ticket className="w-4 h-4" /> Mis tickets</h3>
            {tickets.length === 0 ? (
              <p className="text-xs text-slate-500">Sin tickets abiertos.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {tickets.map((t) => (
                  <li key={t.id} className="flex justify-between border border-slate-800 rounded-lg px-3 py-2">
                    <span>{t.title}</span>
                    <span className="text-slate-400 uppercase">{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-t border-slate-800 pt-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-2"><HandCoins className="w-4 h-4" /> Promesa de pago</h3>
            <div className="flex gap-2 text-xs">
              <input type="date" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-2" />
              <input type="number" placeholder="Monto" value={promiseAmount} onChange={(e) => setPromiseAmount(e.target.value)} className="w-24 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2" />
              <button type="button" onClick={() => void submitPromise()} className="px-4 py-2 bg-amber-600/20 border border-amber-500/30 rounded-lg text-amber-200">Solicitar</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
