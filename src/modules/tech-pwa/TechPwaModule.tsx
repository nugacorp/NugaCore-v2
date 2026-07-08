import React, { useCallback, useEffect, useState } from 'react';
import { Wrench, MapPin, Camera, CheckCircle, Wifi, RefreshCw, ListChecks } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../../lib/apiBackoff';

const OFFLINE_KEY = 'nugacore.tech-pwa.queue';

interface TechPwaModuleProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function TechPwaModule({ getAuthHeaders }: TechPwaModuleProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [agenda, setAgenda] = useState<any[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<any[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const [woRes, agRes] = await Promise.all([
        fetchWithRateLimitBackoff('/api/workorders', { headers }),
        fetchWithRateLimitBackoff('/api/workorders/agenda', { headers }),
      ]);
      if (woRes.ok) setOrders(await woRes.json());
      if (agRes.ok) setAgenda(await agRes.json());
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const queueOffline = (orderId: string, action: string, payload: Record<string, unknown>) => {
    const entry = { orderId, action, payload, at: new Date().toISOString() };
    const next = [entry, ...offlineQueue].slice(0, 50);
    setOfflineQueue(next);
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(next));
  };

  const runOrderAction = async (orderId: string, action: string, payload: Record<string, unknown> = {}) => {
    const headers = await getAuthHeaders();
    const path =
      action === 'checklist' ? `/api/workorders/${orderId}/checklist/0/toggle`
        : action === 'status' ? `/api/workorders/${orderId}/status`
          : action === 'evidence' ? `/api/workorders/${orderId}/evidences`
            : `/api/workorders/${orderId}`;
    const method = action === 'note' ? 'PUT' : 'POST';
    try {
      await fetchWithRateLimitBackoff(path, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      void load();
    } catch {
      queueOffline(orderId, action, payload);
    }
  };

  const syncOffline = async () => {
    const headers = await getAuthHeaders();
    const remaining: typeof offlineQueue = [];
    for (const item of offlineQueue) {
      const path =
        item.action === 'checklist' ? `/api/workorders/${item.orderId}/checklist/0/toggle`
          : item.action === 'status' ? `/api/workorders/${item.orderId}/status`
            : `/api/workorders/${item.orderId}/evidences`;
      const method = item.action === 'status' ? 'PATCH' : 'POST';
      try {
        const res = await fetchWithRateLimitBackoff(path, {
          method,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        });
        if (!res.ok) remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }
    setOfflineQueue(remaining);
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(remaining));
    if (remaining.length === 0) void load();
  };

  const pending = orders.filter((o) => o.status !== 'completed' && o.status !== 'canceled');

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wrench className="w-7 h-7 text-amber-400" /> App Técnicos (PWA)
          </h2>
          <p className="text-slate-400 text-sm">Órdenes · agenda · cola offline</p>
        </div>
        <button type="button" onClick={() => void load()} className="p-2 rounded-lg bg-slate-800">
          <RefreshCw className={`w-5 h-5 text-slate-300 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {offlineQueue.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-4">
          <div className="text-amber-200 text-sm mb-2">{offlineQueue.length} acción(es) en cola offline</div>
          <button type="button" onClick={() => void syncOffline()} className="px-4 py-2 bg-amber-600 rounded-lg text-white text-sm">Sincronizar</button>
        </div>
      )}

      {agenda.length > 0 && (
        <section className="bg-slate-950 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-2">Agenda de hoy ({agenda.length})</h3>
          <ul className="text-xs text-slate-400 space-y-1">
            {agenda.slice(0, 5).map((a) => (
              <li key={a.id}>{a.date} · {a.clientName ?? a.clientId} · {a.status}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="space-y-3">
        {pending.map((o) => (
          <div key={o.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-white font-medium">{o.title ?? o.type}</div>
                <div className="text-slate-400 text-sm flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3" /> {o.clientName ?? o.clientId} · {o.date}
                </div>
              </div>
              <span className="text-xs text-indigo-300 uppercase">{o.status}</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="button" onClick={() => void runOrderAction(o.id, 'evidence', { note: 'Fotos en sitio', type: 'photo' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                <Camera className="w-3 h-3" /> Evidencia
              </button>
              <button type="button" onClick={() => void runOrderAction(o.id, 'checklist', {})} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                <ListChecks className="w-3 h-3" /> Checklist
              </button>
              <button type="button" onClick={() => void runOrderAction(o.id, 'status', { status: 'in_progress' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                <CheckCircle className="w-3 h-3" /> En curso
              </button>
              <button type="button" onClick={() => void runOrderAction(o.id, 'status', { status: 'completed' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-900/40 text-emerald-300 text-xs">
                <Wifi className="w-3 h-3" /> Completar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
