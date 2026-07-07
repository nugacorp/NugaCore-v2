import React, { useCallback, useEffect, useState } from 'react';
import { Wrench, MapPin, Camera, CheckCircle, Wifi, RefreshCw } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../../lib/apiBackoff';

const OFFLINE_KEY = 'nugacore.tech-pwa.queue';

interface TechPwaModuleProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function TechPwaModule({ getAuthHeaders }: TechPwaModuleProps) {
  const [orders, setOrders] = useState<any[]>([]);
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
      const res = await fetchWithRateLimitBackoff('/api/workorders', { headers });
      if (res.ok) setOrders(await res.json());
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const queueOfflineNote = (orderId: string, note: string) => {
    const entry = { orderId, note, at: new Date().toISOString() };
    const next = [entry, ...offlineQueue].slice(0, 50);
    setOfflineQueue(next);
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(next));
  };

  const syncOffline = async () => {
    if (offlineQueue.length === 0) return;
    const headers = await getAuthHeaders();
    for (const item of offlineQueue) {
      await fetchWithRateLimitBackoff(`/api/workorders/${item.orderId}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: `[PWA offline] ${item.note}` }),
      }).catch(() => undefined);
    }
    setOfflineQueue([]);
    localStorage.removeItem(OFFLINE_KEY);
    void load();
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wrench className="w-7 h-7 text-amber-400" /> App Técnicos (PWA)
          </h2>
          <p className="text-slate-400 text-sm">Órdenes de campo · cola offline</p>
        </div>
        <button type="button" onClick={() => void load()} className="p-2 rounded-lg bg-slate-800">
          <RefreshCw className={`w-5 h-5 text-slate-300 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {offlineQueue.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-4">
          <div className="text-amber-200 text-sm mb-2">{offlineQueue.length} nota(s) en cola offline</div>
          <button type="button" onClick={() => void syncOffline()} className="px-4 py-2 bg-amber-600 rounded-lg text-white text-sm">
            Sincronizar
          </button>
        </div>
      )}

      <div className="space-y-3">
        {orders.filter((o) => o.status !== 'completed' && o.status !== 'canceled').map((o) => (
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
              <button type="button" onClick={() => queueOfflineNote(o.id, 'Fotos tomadas en sitio')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                <Camera className="w-3 h-3" /> Foto
              </button>
              <button type="button" onClick={() => queueOfflineNote(o.id, 'Checklist completado')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs">
                <CheckCircle className="w-3 h-3" /> Checklist
              </button>
              <button type="button" onClick={() => queueOfflineNote(o.id, 'Cliente activado')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-900/40 text-emerald-300 text-xs">
                <Wifi className="w-3 h-3" /> Activar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
