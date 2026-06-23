import React, { useCallback, useEffect, useState } from 'react';
import { Warehouse as WarehouseIcon, Plus, Trash2, Pencil, PackageSearch, XCircle, RefreshCw } from 'lucide-react';

// ====================================================================
// Fase 5.1 — Gestión de Almacenes (UI aditiva).
//
// Módulo autocontenido (self-fetch con getAuthHeaders), reutilizando el tema
// slate-900/indigo del resto del Inventario. NO redisña componentes existentes.
// Persiste contra /api/inventory/warehouses (store o DB según USE_DB_INVENTORY).
// ====================================================================

type WarehouseType = 'principal' | 'torre' | 'vehiculo' | 'tecnico' | 'otro';

interface Warehouse {
  id: string;
  code?: string;
  name: string;
  type: WarehouseType;
  location?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StockRow {
  itemId: string;
  name: string;
  category: string;
  model: string;
  brand: string;
  qty: number;
}

interface WarehouseStock {
  warehouse: string;
  totalUnits: number;
  distinctItems: number;
  items: StockRow[];
}

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const TYPE_LABEL: Record<WarehouseType, string> = {
  principal: 'Principal',
  torre: 'Torre',
  vehiculo: 'Vehículo',
  tecnico: 'Técnico',
  otro: 'Otro',
};

const emptyForm = { name: '', code: '', type: 'otro' as WarehouseType, location: '', notes: '' };

export default function WarehousesModule({ getAuthHeaders }: Props) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [stock, setStock] = useState<WarehouseStock | null>(null);
  const [stockLoading, setStockLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/inventory/warehouses', { headers });
      if (!res.ok) throw new Error('No se pudieron cargar los almacenes.');
      setWarehouses(await res.json());
    } catch (err) {
      setWarehouses([]);
      setError(err instanceof Error ? err.message : 'Error al cargar almacenes.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setEditId(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (wh: Warehouse) => {
    setEditId(wh.id);
    setForm({ name: wh.name, code: wh.code ?? '', type: wh.type, location: wh.location ?? '', notes: wh.notes ?? '' });
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setError('');
    try {
      const headers = { ...(await getAuthHeaders()), 'Content-Type': 'application/json' };
      const url = editId ? `/api/inventory/warehouses/${editId}` : '/api/inventory/warehouses';
      const res = await fetch(url, { method: editId ? 'PUT' : 'POST', headers, body: JSON.stringify(form) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo guardar el almacén.');
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el almacén.');
    }
  };

  const remove = async (wh: Warehouse) => {
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inventory/warehouses/${wh.id}`, { method: 'DELETE', headers });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo eliminar el almacén.');
      }
      if (stock?.warehouse === wh.name) setStock(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el almacén.');
    }
  };

  const viewStock = async (wh: Warehouse) => {
    setStockLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/inventory/warehouses/${wh.id}/stock`, { headers });
      if (!res.ok) throw new Error('No se pudo cargar el stock del almacén.');
      setStock(await res.json());
    } catch (err) {
      setStock(null);
      setError(err instanceof Error ? err.message : 'Error al cargar stock.');
    } finally {
      setStockLoading(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-200 p-6 bg-slate-900 min-h-screen font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center space-x-2">
            <WarehouseIcon className="w-6 h-6 text-indigo-400" />
            <span>Almacenes & Ubicaciones</span>
          </h2>
          <p className="text-sm text-slate-400 font-mono mt-0.5">
            Gestión de almacenes (principal, torres, vehículos técnicos) y stock por ubicación.
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
            id="btn-add-warehouse"
            className="inline-flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition shadow-lg shadow-indigo-600/15 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Almacén</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center space-x-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-300 text-sm">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lista de almacenes */}
        <div className="lg:col-span-2 bg-slate-950 p-5 rounded-3xl border border-slate-800 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Cargando almacenes...</div>
          ) : warehouses.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No hay almacenes registrados.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {warehouses.map((wh) => (
                <div
                  key={wh.id}
                  id={`warehouse-card-${wh.id}`}
                  className="bg-slate-900/40 hover:bg-slate-900/80 rounded-2xl border border-slate-800 p-4 transition group"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded font-mono font-bold uppercase">
                        {TYPE_LABEL[wh.type]}
                      </span>
                      <h4 className="text-base font-bold text-white mt-1.5 leading-snug">{wh.name}</h4>
                      {wh.location && <p className="text-[10px] text-slate-500 font-mono mt-0.5">{wh.location}</p>}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${
                      wh.isActive ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}>
                      {wh.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => void viewStock(wh)}
                      className="flex-1 py-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-900/90 text-slate-300 font-semibold font-mono text-[10px] uppercase tracking-wider transition flex items-center justify-center space-x-1"
                    >
                      <PackageSearch className="w-3 h-3" />
                      <span>Ver stock</span>
                    </button>
                    <button
                      onClick={() => openEdit(wh)}
                      className="py-1.5 px-2 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-900/90 text-slate-300 transition"
                      title="Editar"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => void remove(wh)}
                      className="py-1.5 px-2 rounded-lg border border-rose-900/60 bg-slate-950 hover:bg-rose-950/40 text-rose-300 transition"
                      title="Eliminar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel de stock por almacén */}
        <div className="bg-slate-950 p-5 rounded-3xl border border-slate-800">
          <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5 border-b border-slate-900 pb-3">
            <PackageSearch className="w-4 h-4 text-indigo-400" />
            <span>Stock por almacén</span>
          </h3>
          {stockLoading ? (
            <div className="py-10 text-center text-sm text-slate-500">Cargando stock...</div>
          ) : !stock ? (
            <div className="py-10 text-center text-xs text-slate-500">Selecciona "Ver stock" en un almacén.</div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">{stock.warehouse}</span>
                <span className="text-slate-300">
                  <strong className="text-emerald-400">{stock.totalUnits}</strong> uds · {stock.distinctItems} artículos
                </span>
              </div>
              {stock.items.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500">Sin existencias en este almacén.</div>
              ) : (
                <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                  {stock.items.map((it) => (
                    <div key={it.itemId} className="flex items-center justify-between bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-200 truncate">{it.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">{it.brand} · {it.model}</p>
                      </div>
                      <span className="text-sm font-mono font-bold text-emerald-400 ml-2">{it.qty}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal alta/edición */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white font-mono flex items-center space-x-1.5">
                <WarehouseIcon className="w-4 h-4 text-indigo-400" />
                <span>{editId ? 'Editar Almacén' : 'Nuevo Almacén'}</span>
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white font-bold text-sm">✕</button>
            </div>
            <form onSubmit={submit} className="space-y-4 text-xs font-mono">
              <div className="space-y-1">
                <label className="text-slate-400">Nombre</label>
                <input
                  type="text" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Almacén Sur, Coche Técnico 3"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Tipo</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as WarehouseType })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  >
                    {(Object.keys(TYPE_LABEL) as WarehouseType[]).map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">Código (opcional)</label>
                  <input
                    type="text" value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="ALM-SUR"
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-slate-400">Ubicación (opcional)</label>
                <input
                  type="text" value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Dirección o referencia"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400">Notas (opcional)</label>
                <input
                  type="text" value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button type="button" onClick={() => setShowModal(false)} className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl">Cancelar</button>
                <button type="submit" id="btn-confirm-warehouse" className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl font-bold">
                  {editId ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
