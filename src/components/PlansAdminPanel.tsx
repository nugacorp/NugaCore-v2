import React, { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../lib/errors';
import { createAuthorizedApi } from '../lib/apiClient';
import { AlertCircle, CheckCircle2, Loader2, Pencil, Plus, Trash2, Wifi } from 'lucide-react';
import type { Plan } from '../types';
import type { UserRole } from '../lib/supabase';

export type PlanRecord = Plan & {
  businessType?: 'Residencial' | 'Empresarial' | 'Dedicado';
  isActive?: boolean;
};

interface PlansAdminPanelProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
  canManage: boolean;
  userRole: UserRole;
  onPlansChanged?: (plans: PlanRecord[]) => void;
}

const emptyForm = () => ({
  name: '',
  speedMbpsDown: '50',
  speedMbpsUp: '20',
  price: '399',
  type: 'PPPoE' as Plan['type'],
  businessType: 'Residencial' as NonNullable<PlanRecord['businessType']>,
  isActive: true,
});

export default function PlansAdminPanel({
  getAuthHeaders,
  canManage,
  onPlansChanged,
}: PlansAdminPanelProps) {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const rows = await api.get<PlanRecord[]>('/api/plans');
      setPlans(rows);
      onPlansChanged?.(rows);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar los planes.'));
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, onPlansChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setOk('');
    setError('');
  };

  const openEdit = (plan: PlanRecord) => {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      speedMbpsDown: String(plan.speedMbpsDown),
      speedMbpsUp: String(plan.speedMbpsUp),
      price: String(plan.price),
      type: plan.type,
      businessType: plan.businessType || 'Residencial',
      isActive: plan.isActive !== false,
    });
    setShowForm(true);
    setOk('');
    setError('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError('');
    setOk('');
    const payload = {
      name: form.name.trim(),
      speedMbpsDown: Number(form.speedMbpsDown),
      speedMbpsUp: Number(form.speedMbpsUp),
      price: Number(form.price),
      type: form.type,
      businessType: form.businessType,
      isActive: form.isActive,
    };
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      if (editingId) {
        await api.put(`/api/plans/${editingId}`, payload);
        setOk('Plan actualizado.');
      } else {
        await api.post('/api/plans', payload);
        setOk('Plan creado. Ya puedes asignarlo a clientes de cualquier zona.');
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo guardar el plan.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (plan: PlanRecord) => {
    if (!canManage) return;
    if (!window.confirm(`¿Eliminar el plan «${plan.name}»? Solo si ningún cliente lo usa.`)) return;
    setBusy(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.delete(`/api/plans/${plan.id}`);
      setOk('Plan eliminado.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo eliminar (¿está en uso?).'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Wifi className="w-4 h-4 text-sky-400" />
            Catálogo de planes
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
            Estos megas alimentan el alta del cliente en el router de la zona (PPPoE, Simple Queue o perfil
            según el tipo del plan y la configuración del MikroTik). El precio alimenta la facturación.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo plan
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-rose-900/50 bg-rose-950/50 text-xs text-rose-200 flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {ok && (
        <div className="p-3 rounded-xl border border-emerald-900/50 bg-emerald-950/50 text-xs text-emerald-200 flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}
        </div>
      )}

      {showForm && canManage && (
        <form onSubmit={save} className="p-4 rounded-2xl border border-slate-800 bg-slate-950/80 space-y-3">
          <p className="text-xs font-bold text-slate-300">
            {editingId ? `Editar ${editingId}` : 'Alta de plan'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Nombre
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white normal-case font-normal"
                placeholder="Residencial 50/20"
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Precio (MXN)
              <input
                required
                type="number"
                min={0}
                step="1"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white normal-case font-normal"
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Baja (Mbps)
              <input
                required
                type="number"
                min={1}
                value={form.speedMbpsDown}
                onChange={(e) => setForm((f) => ({ ...f, speedMbpsDown: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white normal-case font-normal"
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Subida (Mbps)
              <input
                required
                type="number"
                min={1}
                value={form.speedMbpsUp}
                onChange={(e) => setForm((f) => ({ ...f, speedMbpsUp: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white normal-case font-normal"
              />
            </label>
            <label className="space-y-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Tipo en router
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as Plan['type'] }))}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white normal-case font-normal"
              >
                <option value="PPPoE">PPPoE (+ Simple Queue)</option>
                <option value="Static">IP estática + Simple Queue</option>
                <option value="DHCP">DHCP + Simple Queue</option>
                <option value="Hotspot">Hotspot</option>
              </select>
            </label>
            <label className="space-y-1 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Segmento
              <select
                value={form.businessType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    businessType: e.target.value as PlanRecord['businessType'],
                  }))
                }
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white normal-case font-normal"
              >
                <option value="Residencial">Residencial</option>
                <option value="Empresarial">Empresarial</option>
                <option value="Dedicado">Dedicado</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Activo (visible al dar de alta clientes)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-2 rounded-xl border border-slate-700 text-xs text-slate-400"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold disabled:opacity-50"
            >
              {busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear plan'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando planes…
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-10 text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
          Aún no hay planes. Crea el primero (ej. Residencial 50/20) para poder dar de alta clientes.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-3 py-2.5">Plan</th>
                <th className="px-3 py-2.5">Mbps</th>
                <th className="px-3 py-2.5">Precio</th>
                <th className="px-3 py-2.5">Tipo router</th>
                <th className="px-3 py-2.5">Estado</th>
                {canManage && <th className="px-3 py-2.5 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {plans.map((plan) => (
                <tr key={plan.id} className="bg-slate-900/40 hover:bg-slate-900/70">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-white">{plan.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{plan.id}</div>
                  </td>
                  <td className="px-3 py-3 text-sky-300 font-mono">
                    {plan.speedMbpsDown}/{plan.speedMbpsUp}
                  </td>
                  <td className="px-3 py-3 text-slate-200">${plan.price}</td>
                  <td className="px-3 py-3 text-slate-300">{plan.type}</td>
                  <td className="px-3 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] border ${
                        plan.isActive === false
                          ? 'border-slate-700 text-slate-500'
                          : 'border-emerald-800 text-emerald-400'
                      }`}
                    >
                      {plan.isActive === false ? 'Inactivo' : 'Activo'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-3 py-3 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => openEdit(plan)}
                        className="inline-flex p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-sky-300"
                        aria-label="Editar plan"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(plan)}
                        className="inline-flex p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300"
                        aria-label="Eliminar plan"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
