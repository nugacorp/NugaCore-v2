import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Plus, CheckCircle, XCircle, Ban, RefreshCw, Clock } from 'lucide-react';

// ====================================================================
// Fase 5.1 — Transferencias entre almacenes (UI aditiva).
//
// Módulo autocontenido. Modela el ciclo de vida de una transferencia de
// primera clase: pending → completed | cancelled. Al completar se mueve el
// stock real. Reutiliza el tema slate-900/indigo del Inventario.
// ====================================================================

type TransferStatus = 'pending' | 'completed' | 'cancelled';

interface InventoryTransfer {
  id: string;
  itemId: string;
  itemName: string;
  qty: number;
  fromWarehouse: string;
  toWarehouse: string;
  status: TransferStatus;
  reason?: string;
  createdAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

interface ItemView {
  id: string;
  name: string;
  warehouse: string;
  qty: number;
}

interface Warehouse {
  id: string;
  name: string;
  isActive: boolean;
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const STATUS_BADGE: Record<TransferStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
  cancelled: 'bg-slate-700/40 text-slate-400 border-slate-700',
};

const STATUS_LABEL: Record<TransferStatus, string> = {
  pending: 'Pendiente',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

export default function InventoryTransfersModule({ getAuthHeaders }: Props) {
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [items, setItems] = useState<ItemView[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [formItemId, setFormItemId] = useState('');
  const [formQty, setFormQty] = useState('1');
  const [formDest, setFormDest] = useState('');
  const [formReason, setFormReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const [trRes, itRes, whRes] = await Promise.all([
        fetch('/api/inventory/transfers', { headers }),
        fetch('/api/inventory', { headers }),
        fetch('/api/inventory/warehouses', { headers }),
      ]);
      if (!trRes.ok || !itRes.ok || !whRes.ok) throw new Error('No se pudieron cargar las transferencias.');
      setTransfers(await trRes.json());
      setItems(await itRes.json());
      setWarehouses(await whRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar transferencias.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const selectedItem = items.find((i) => i.id === formItemId);

  const openCreate = () => {
    setFormItemId(items[0]?.id ?? '');
    setFormQty('1');
    setFormDest('');
    setFormReason('');
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formItemId || !formDest) return;
    setError('');
    try {
      const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
      const res = await fetch('/api/inventory/transfers', {
        method: 'POST',
        headers,
        body: JSON.stringify({ itemId: formItemId, qty: Number(formQty), toWarehouse: formDest, reason: formReason || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo crear la transferencia.');
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la transferencia.');
    }
  };

  const act = async (id: string, action: 'complete' | 'cancel') => {
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inventory/transfers/${id}/${action}`, { method: 'POST', headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo actualizar la transferencia.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al actualizar la transferencia.');
    }
  };

  const destinations = warehouses.filter((w) => w.name !== selectedItem?.warehouse);

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <ArrowLeftRight className="w-6 h-6 text-indigo-400" />
            <span>Transferencias entre Almacenes</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Traspasos con ciclo de vida: pendiente → completada o cancelada. El stock se mueve al completar.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => void load()}
            className="inline-flex items-center space-x-1.5 px-2.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:bg-slate-700 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refrescar</span>
          </button>
          <button
            onClick={openCreate}
            id="btn-add-transfer"
            className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition shadow-lg shadow-indigo-600/15 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Transferencia</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="bg-slate-950 rounded-3xl border border-slate-800 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">Cargando transferencias...</div>
        ) : transfers.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">No hay transferencias registradas.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Artículo</th>
                  <th className="text-left px-4 py-3 font-medium">Cant.</th>
                  <th className="text-left px-4 py-3 font-medium">Origen → Destino</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-right px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {transfers.map((t) => (
                  <tr key={t.id} id={`transfer-row-${t.id}`} className="hover:bg-slate-900/40">
                    <td className="px-4 py-3 text-slate-200">{t.itemName}</td>
                    <td className="px-4 py-3 font-mono text-emerald-400 font-bold">{t.qty}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">
                      {t.fromWarehouse} <span className="text-indigo-400">→</span> {t.toWarehouse}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-mono ${STATUS_BADGE[t.status]}`}>
                        {t.status === 'pending' && <Clock className="w-3 h-3" />}
                        {t.status === 'completed' && <CheckCircle className="w-3 h-3" />}
                        {t.status === 'cancelled' && <Ban className="w-3 h-3" />}
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {t.status === 'pending' ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => void act(t.id, 'complete')}
                            className="text-[11px] px-2.5 py-1 rounded-lg border border-emerald-900/60 bg-slate-950 hover:bg-emerald-950/40 text-emerald-300 font-mono transition"
                          >
                            Completar
                          </button>
                          <button
                            onClick={() => void act(t.id, 'cancel')}
                            className="text-[11px] px-2.5 py-1 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-900 text-slate-400 font-mono transition"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-600 font-mono">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal nueva transferencia */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5">
                <ArrowLeftRight className="w-4 h-4 text-indigo-400" />
                <span>Nueva Transferencia</span>
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white font-bold text-sm">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Artículo</label>
                <select
                  value={formItemId}
                  onChange={(e) => setFormItemId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                >
                  {items.length === 0 && <option value="">Sin artículos</option>}
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} — {i.warehouse} (stock {i.qty})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Cantidad</label>
                  <input
                    type="number" min="1" required value={formQty}
                    onChange={(e) => setFormQty(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Destino</label>
                  <select
                    value={formDest}
                    onChange={(e) => setFormDest(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Seleccionar…</option>
                    {destinations.map((w) => (
                      <option key={w.id} value={w.name}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {selectedItem && (
                <p className="text-[10px] text-slate-500">Origen: <strong className="text-slate-300">{selectedItem.warehouse}</strong> · disponible {selectedItem.qty}</p>
              )}
              <div className="space-y-1">
                <label className="text-slate-400">Motivo (opcional)</label>
                <input
                  type="text" value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button type="button" onClick={() => setShowModal(false)} className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl">Cancelar</button>
                <button type="submit" id="btn-confirm-transfer" className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold">Crear (pendiente)</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
