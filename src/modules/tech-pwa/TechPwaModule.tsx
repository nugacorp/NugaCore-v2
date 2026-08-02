import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wrench,
  MapPin,
  Camera,
  CheckCircle,
  RefreshCw,
  ListChecks,
  Link2,
  Copy,
  Check,
  CalendarDays,
  Inbox,
  CloudOff,
  Play,
  CircleDot,
  AlertTriangle,
} from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../../lib/apiBackoff';
import { getAppScope } from '../../lib/appScope';
import { buildTechAppShareUrl } from '../../lib/techAppLinks';
import { classifyRxPower, RX_POWER_LABELS } from '../../lib/ftthOptical';
import type { FtthWorkOrderFields } from '../../types';

const OFFLINE_KEY = 'nugacore.tech-pwa.queue';

interface TechPwaModuleProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

type WorkOrder = {
  id: string;
  title?: string;
  type?: string;
  status?: string;
  clientName?: string;
  clientId?: string;
  date?: string;
  address?: string;
  technicianName?: string;
  technology?: 'radio' | 'fiber';
  ftth?: FtthWorkOrderFields;
};

/** Captura FTTH en edición, por orden. */
type FtthDraft = {
  onuSerial: string;
  napId: string;
  napPort: string;
  rxPowerDbm: string;
};

const draftFrom = (order: WorkOrder): FtthDraft => ({
  onuSerial: order.ftth?.onuSerial ?? '',
  napId: order.ftth?.napId ?? '',
  napPort: order.ftth?.napPort != null ? String(order.ftth.napPort) : '',
  rxPowerDbm: order.ftth?.rxPowerDbm != null ? String(order.ftth.rxPowerDbm) : '',
});

const draftToPayload = (draft: FtthDraft): Record<string, unknown> => ({
  onuSerial: draft.onuSerial.trim(),
  napId: draft.napId.trim(),
  napPort: draft.napPort,
  rxPowerDbm: draft.rxPowerDbm,
  measuredAt: new Date().toISOString(),
});

type AgendaItem = {
  id: string;
  date?: string;
  clientName?: string;
  clientId?: string;
  status?: string;
  title?: string;
};

type OfflineEntry = {
  orderId: string;
  action: string;
  payload: Record<string, unknown>;
  at: string;
};

const statusLabel = (status: string | undefined): string => {
  switch (String(status || '').toLowerCase()) {
    case 'pending':
    case 'open':
    case 'assigned':
      return 'Pendiente';
    case 'in_progress':
    case 'in-progress':
      return 'En curso';
    case 'completed':
    case 'done':
      return 'Completada';
    case 'canceled':
    case 'cancelled':
      return 'Cancelada';
    default:
      return status || '—';
  }
};

const statusTone = (status: string | undefined): string => {
  switch (String(status || '').toLowerCase()) {
    case 'in_progress':
    case 'in-progress':
      return 'text-amber-300 bg-amber-950/40 border-amber-700/40';
    case 'completed':
    case 'done':
      return 'text-emerald-300 bg-emerald-950/40 border-emerald-700/40';
    case 'canceled':
    case 'cancelled':
      return 'text-slate-400 bg-slate-900 border-slate-700';
    default:
      return 'text-sky-300 bg-sky-950/40 border-sky-700/40';
  }
};

export default function TechPwaModule({ getAuthHeaders }: TechPwaModuleProps) {
  const scope = getAppScope();
  const isTechShell = scope === 'tech';

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [ftthDrafts, setFtthDrafts] = useState<Record<string, FtthDraft>>({});
  /** Motivos por los que el servidor rechazó cerrar una orden de fibra. */
  const [blockers, setBlockers] = useState<Record<string, string[]>>({});

  const techLink = useMemo(() => {
    try {
      return buildTechAppShareUrl(window.location.origin);
    } catch {
      return '';
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const [woRes, agRes] = await Promise.all([
        fetchWithRateLimitBackoff('/api/workorders', { headers }),
        fetchWithRateLimitBackoff('/api/workorders/agenda', { headers }),
      ]);
      if (!woRes.ok) {
        const body = await woRes.json().catch(() => ({}));
        throw new Error(body?.error || `No se pudieron cargar las órdenes (${woRes.status})`);
      }
      setOrders(await woRes.json());
      if (agRes.ok) setAgenda(await agRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar la app de técnicos');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyTechLink = async () => {
    if (!techLink) return;
    try {
      await navigator.clipboard.writeText(techLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copia el enlace de la App Técnicos:', techLink);
    }
  };

  const queueOffline = (orderId: string, action: string, payload: Record<string, unknown>) => {
    const entry = { orderId, action, payload, at: new Date().toISOString() };
    const next = [entry, ...offlineQueue].slice(0, 50);
    setOfflineQueue(next);
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(next));
    setActionMsg('Sin red: acción guardada en cola offline.');
  };

  const runOrderAction = async (orderId: string, action: string, payload: Record<string, unknown> = {}) => {
    setActionMsg('');
    const headers = await getAuthHeaders();
    const path =
      action === 'checklist'
        ? `/api/workorders/${orderId}/checklist/0/toggle`
        : action === 'status'
          ? `/api/workorders/${orderId}/status`
          : action === 'evidence'
            ? `/api/workorders/${orderId}/evidences`
            : `/api/workorders/${orderId}`;
    const method = action === 'note' ? 'PUT' : 'POST';
    try {
      const res = await fetchWithRateLimitBackoff(path, {
        method,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // 4xx = el servidor rechazó la acción (p. ej. checklist FTTH incompleto).
        // Reintentarla desde la cola offline nunca funcionaría: se muestra el motivo.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string; details?: { errors?: string[] } }
            | null;
          const reasons = body?.details?.errors ?? (body?.error ? [body.error] : []);
          setBlockers((prev) => ({ ...prev, [orderId]: reasons }));
          setActionMsg(reasons[0] ?? 'El servidor rechazó la acción.');
          return;
        }
        setActionMsg('No se pudo aplicar la acción en el servidor.');
        queueOffline(orderId, action, payload);
        return;
      }
      setBlockers((prev) => {
        if (!prev[orderId]) return prev;
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      setActionMsg(
        action === 'status' && payload.status === 'completed'
          ? 'Orden marcada como completada.'
          : 'Acción registrada.',
      );
      void load();
    } catch {
      queueOffline(orderId, action, payload);
    }
  };

  const setDraftField = (order: WorkOrder, field: keyof FtthDraft, value: string) => {
    setFtthDrafts((prev) => ({
      ...prev,
      [order.id]: { ...(prev[order.id] ?? draftFrom(order)), [field]: value },
    }));
  };

  /** Cierra la orden enviando la captura FTTH cuando la tecnología es fibra. */
  const completeOrder = (order: WorkOrder) => {
    if (order.technology !== 'fiber') {
      void runOrderAction(order.id, 'status', { status: 'completed' });
      return;
    }
    const draft = ftthDrafts[order.id] ?? draftFrom(order);
    void runOrderAction(order.id, 'status', {
      status: 'completed',
      ftth: draftToPayload(draft),
    });
  };

  const syncOffline = async () => {
    setActionMsg('');
    const headers = await getAuthHeaders();
    const remaining: OfflineEntry[] = [];
    for (const item of offlineQueue) {
      const path =
        item.action === 'checklist'
          ? `/api/workorders/${item.orderId}/checklist/0/toggle`
          : item.action === 'status'
            ? `/api/workorders/${item.orderId}/status`
            : `/api/workorders/${item.orderId}/evidences`;
      try {
        const res = await fetchWithRateLimitBackoff(path, {
          method: 'POST',
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
    setActionMsg(
      remaining.length === 0
        ? 'Cola offline sincronizada.'
        : `${remaining.length} acción(es) siguen pendientes.`,
    );
    if (remaining.length === 0) void load();
  };

  const pending = orders.filter((o) => {
    const s = String(o.status || '').toLowerCase();
    return s !== 'completed' && s !== 'done' && s !== 'canceled' && s !== 'cancelled';
  });
  const inProgress = pending.filter((o) => String(o.status || '').toLowerCase().includes('progress'));
  const todo = pending.filter((o) => !String(o.status || '').toLowerCase().includes('progress'));

  return (
    <div className="relative min-h-[70vh]">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="absolute bottom-10 right-0 h-48 w-48 rounded-full bg-sky-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl space-y-5 p-4 md:p-6 animate-[fadeIn_0.35s_ease-out]">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-amber-400/90">NugaCore</p>
            <h2 className="mt-1 text-2xl md:text-3xl font-bold text-white tracking-tight flex items-center gap-2">
              <Wrench className="w-7 h-7 text-amber-400 shrink-0" />
              {isTechShell ? 'Mi jornada' : 'App Técnicos'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {isTechShell
                ? 'Órdenes de campo, agenda y sincronización offline.'
                : 'Vista de campo y enlace para compartir con el equipo técnico.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px] font-mono text-slate-300 hover:border-slate-600 transition disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </header>

        {/* Acceso rápido: copiar enlace */}
        <section className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-950/45 to-slate-950/80 p-4 md:p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-amber-500/15 p-2.5 border border-amber-500/20">
              <Link2 className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-white">Enlace de la App Técnicos</h3>
                <p className="text-[12px] text-slate-400 leading-snug mt-0.5">
                  Cópialo y envíalo al técnico. Al abrirlo entra a{' '}
                  <span className="text-amber-300/90 font-mono">/?app=tech</span> (PWA de campo).
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  readOnly
                  value={techLink}
                  className="flex-1 truncate rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2.5 text-[11px] font-mono text-slate-300"
                  aria-label="URL de la App Técnicos"
                />
                <button
                  id="copy-tech-app-link"
                  type="button"
                  onClick={() => void copyTechLink()}
                  disabled={!techLink}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? '¡Copiado!' : 'Copiar enlace'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* KPIs rápidos */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Pendientes</p>
            <p className="text-xl font-bold text-white mt-0.5">{todo.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">En curso</p>
            <p className="text-xl font-bold text-amber-300 mt-0.5">{inProgress.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-3">
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-500">Offline</p>
            <p className="text-xl font-bold text-sky-300 mt-0.5">{offlineQueue.length}</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-800/50 bg-rose-950/40 px-3 py-2.5 text-sm text-rose-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {actionMsg && (
          <p className="text-xs font-mono text-emerald-300/90 animate-[fadeIn_0.25s_ease-out]">{actionMsg}</p>
        )}

        {offlineQueue.length > 0 && (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-950/25 p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-100">
              <CloudOff className="w-4 h-4" />
              <h3 className="text-sm font-semibold">
                {offlineQueue.length} acción(es) en cola offline
              </h3>
            </div>
            <p className="text-[12px] text-amber-100/70 leading-snug">
              Se guardaron en este dispositivo. Al tener red, sincroniza para aplicarlas en NugaCore.
            </p>
            <button
              id="tech-sync-offline"
              type="button"
              onClick={() => void syncOffline()}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition"
            >
              <RefreshCw className="w-4 h-4" />
              Sincronizar ahora
            </button>
          </section>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden">
          <div className="border-b border-slate-800/80 px-4 md:px-5 py-3 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">Agenda de hoy</h3>
            <span className="ml-auto text-[11px] font-mono text-slate-500">{agenda.length}</span>
          </div>
          <div className="px-4 md:px-5 py-3">
            {agenda.length === 0 ? (
              <div className="py-6 text-center space-y-1">
                <CalendarDays className="w-8 h-8 text-slate-700 mx-auto" />
                <p className="text-sm text-slate-400">Sin visitas programadas para hoy.</p>
                <p className="text-[11px] text-slate-600 font-mono">
                  Las órdenes con fecha de hoy aparecen aquí.
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {agenda.slice(0, 8).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2.5 text-xs"
                  >
                    <span className="text-slate-200 truncate">
                      {a.title || a.clientName || a.clientId || a.id}
                    </span>
                    <span className="font-mono text-slate-500 shrink-0">
                      {a.date || '—'} · {statusLabel(a.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2 px-0.5">
            <Inbox className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-white">Órdenes activas</h3>
            <span className="ml-auto text-[11px] font-mono text-slate-500">{pending.length}</span>
          </div>

          {loading && pending.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 py-10 text-center text-sm text-slate-500 font-mono">
              Cargando órdenes…
            </div>
          )}

          {!loading && pending.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 py-10 px-4 text-center space-y-2">
              <CircleDot className="w-9 h-9 text-slate-700 mx-auto" />
              <p className="text-sm text-slate-300 font-medium">No hay órdenes pendientes</p>
              <p className="text-[12px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                Cuando soporte o administración asignen una OT, aparece aquí para evidencia, checklist y cierre en campo.
              </p>
            </div>
          )}

          {pending.map((o) => (
            <article
              key={o.id}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3"
            >
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <h4 className="text-white font-medium truncate">{o.title ?? o.type ?? 'Orden de trabajo'}</h4>
                  <p className="text-slate-400 text-sm flex items-center gap-1 mt-1">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      {o.clientName ?? o.clientId ?? 'Cliente'}
                      {o.date ? ` · ${o.date}` : ''}
                    </span>
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[10px] uppercase font-mono px-2 py-1 rounded-lg border ${statusTone(o.status)}`}
                >
                  {statusLabel(o.status)}
                </span>
              </div>
              {o.technology === 'fiber' && (() => {
                const draft = ftthDrafts[o.id] ?? draftFrom(o);
                const rx = draft.rxPowerDbm.trim() === '' ? null : Number(draft.rxPowerDbm);
                const rxClass = rx !== null && Number.isFinite(rx) ? classifyRxPower(rx) : null;
                const rxTone =
                  rxClass === 'good'
                    ? 'border-emerald-700/60 text-emerald-300'
                    : rxClass === 'degraded'
                      ? 'border-amber-700/60 text-amber-300'
                      : rxClass
                        ? 'border-rose-700/60 text-rose-300'
                        : 'border-slate-800 text-slate-200';
                return (
                  <div className="rounded-xl border border-sky-900/50 bg-slate-950/60 p-3 space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-sky-300">
                      Entrega FTTH · obligatoria para cerrar
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="col-span-2 space-y-1">
                        <span className="text-[9px] uppercase text-slate-500 block">Serie de ONU</span>
                        <input
                          value={draft.onuSerial}
                          onChange={(e) => setDraftField(o, 'onuSerial', e.target.value)}
                          placeholder="48575443…"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-sky-700 focus:outline-none"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[9px] uppercase text-slate-500 block">Caja NAP</span>
                        <input
                          value={draft.napId}
                          onChange={(e) => setDraftField(o, 'napId', e.target.value)}
                          placeholder="NAP-01"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-sky-700 focus:outline-none"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[9px] uppercase text-slate-500 block">Puerto</span>
                        <input
                          type="number"
                          min={1}
                          value={draft.napPort}
                          onChange={(e) => setDraftField(o, 'napPort', e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs font-mono text-slate-200 focus:border-sky-700 focus:outline-none"
                        />
                      </label>
                      <label className="col-span-2 space-y-1">
                        <span className="text-[9px] uppercase text-slate-500 block">Potencia Rx (dBm)</span>
                        <input
                          type="number"
                          step="0.1"
                          value={draft.rxPowerDbm}
                          onChange={(e) => setDraftField(o, 'rxPowerDbm', e.target.value)}
                          placeholder="-21.4"
                          className={`w-full bg-slate-900 border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none ${rxTone}`}
                        />
                      </label>
                    </div>
                    {rxClass && (
                      <p className={`text-[10px] font-mono ${rxClass === 'good' ? 'text-emerald-400' : rxClass === 'degraded' ? 'text-amber-400' : 'text-rose-400'}`}>
                        {RX_POWER_LABELS[rxClass]}
                      </p>
                    )}
                    {blockers[o.id]?.length > 0 && (
                      <ul className="space-y-1 border-t border-slate-800 pt-2">
                        {blockers[o.id].map((reason) => (
                          <li key={reason} className="flex items-start gap-1.5 text-[10px] text-rose-300">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runOrderAction(o.id, 'evidence', { note: 'Fotos en sitio', type: 'photo' })}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-medium hover:border-slate-600 transition"
                >
                  <Camera className="w-3.5 h-3.5" /> Evidencia
                </button>
                <button
                  type="button"
                  onClick={() => void runOrderAction(o.id, 'checklist', {})}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-medium hover:border-slate-600 transition"
                >
                  <ListChecks className="w-3.5 h-3.5" /> Checklist
                </button>
                <button
                  type="button"
                  onClick={() => void runOrderAction(o.id, 'status', { status: 'in_progress' })}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs font-medium hover:border-slate-600 transition"
                >
                  <Play className="w-3.5 h-3.5" /> En curso
                </button>
                <button
                  type="button"
                  onClick={() => completeOrder(o)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950/50 border border-emerald-800/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-900/40 transition"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Completar
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
