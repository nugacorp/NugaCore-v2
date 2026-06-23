import React from 'react';
import {
  X, MapPin, Phone, Mail, Wifi, Router as RouterIcon, CalendarClock,
  CreditCard, Ticket, UserMinus, CheckCircle, Pencil, Network, Navigation, History,
} from 'lucide-react';
import { Client } from '../types';
import { ClientActionCaps } from '../lib/rbac';
import { ClientQuickAction } from './ClientActionsMenu';

// ====================================================================
// Client 360 — Panel integral del cliente (slide-over derecho).
//
// Vista 360 inspirada en WispHub manteniendo la identidad visual de NugaCore
// (tema slate/indigo). Resumen + acciones rápidas (según rol) + historial
// reciente (mock/local). No ejecuta acciones reales; delega en onAction.
// ====================================================================

export interface ClientHistoryEntry {
  id: string;
  kind: 'pago' | 'ticket' | 'evento' | 'cambio';
  label: string;
  detail?: string;
  date: string;
}

interface QuickActionButton {
  key: ClientQuickAction;
  label: string;
  cap: keyof ClientActionCaps;
  icon: React.ReactNode;
  show?: (client: Client) => boolean;
  tone?: 'danger' | 'success' | 'default';
}

const QUICK_ACTIONS: QuickActionButton[] = [
  { key: 'register-payment', label: 'Registrar pago', cap: 'registerPayment', icon: <CreditCard className="w-3.5 h-3.5" /> },
  { key: 'create-ticket', label: 'Crear ticket', cap: 'createTicket', icon: <Ticket className="w-3.5 h-3.5" /> },
  { key: 'suspend', label: 'Suspender', cap: 'suspend', icon: <UserMinus className="w-3.5 h-3.5" />, show: (c) => c.status === 'active', tone: 'danger' },
  { key: 'reactivate', label: 'Reactivar', cap: 'reactivate', icon: <CheckCircle className="w-3.5 h-3.5" />, show: (c) => c.status === 'suspended', tone: 'success' },
  { key: 'edit', label: 'Editar', cap: 'editClient', icon: <Pencil className="w-3.5 h-3.5" /> },
  { key: 'change-ip', label: 'Cambiar IP', cap: 'changeIp', icon: <Network className="w-3.5 h-3.5" /> },
  { key: 'view-location', label: 'Ver ubicación', cap: 'viewLocation', icon: <Navigation className="w-3.5 h-3.5" /> },
];

const STATUS_BADGE: Record<Client['status'], string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  suspended: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  lead: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  baja: 'bg-slate-800 text-slate-500 border-slate-700',
};

const STATUS_LABEL: Record<Client['status'], string> = {
  active: 'Activo', suspended: 'Suspendido', lead: 'Prospecto', baja: 'Baja',
};

interface Props {
  client: Client;
  planName: string;
  caps: ClientActionCaps;
  history: ClientHistoryEntry[];
  onAction: (action: ClientQuickAction, client: Client) => void;
  onClose: () => void;
}

export default function Client360Panel({ client, planName, caps, history, onAction, onClose }: Props) {
  const ip = client.assignedIp || client.ip;
  const hasIp = ip && ip !== '0.0.0.0';
  const hasGps = Number.isFinite(client.lat) && Number.isFinite(client.lng) && !(client.lat === 0 && client.lng === 0);

  const actions = QUICK_ACTIONS.filter((a) => caps[a.cap] && (!a.show || a.show(client)));

  const row = (label: string, value: React.ReactNode, icon?: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wide text-slate-500">
        {icon}{label}
      </span>
      <span className="text-right text-[12px] text-slate-200">{value || '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        id="client-360-panel"
        className="h-full w-full max-w-md overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 space-y-6 text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between border-b border-slate-900 pb-4">
          <div>
            <span className="text-[9px] font-mono tracking-widest uppercase bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded border border-indigo-500/20">
              Cliente 360
            </span>
            <h3 className="mt-2 text-lg font-bold leading-tight text-white">{client.name}</h3>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase ${STATUS_BADGE[client.status]}`}>
                {STATUS_LABEL[client.status]}
              </span>
              <span className="text-[10px] font-mono text-slate-500 uppercase">ID: {client.id}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar Cliente 360" className="text-slate-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resumen */}
        <section aria-label="Resumen del cliente">
          <h4 className="mb-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Resumen</h4>
          <div className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-2 divide-y divide-slate-900/70">
            {row('Plan', planName || 'Sin plan', <Wifi className="w-3 h-3" />)}
            {row('IP asignada', hasIp ? <span className="font-mono">{ip}</span> : 'Sin IP', <Network className="w-3 h-3" />)}
            {row('Router', client.routerId || 'Sin asignar', <RouterIcon className="w-3 h-3" />)}
            {row('Tecnología', client.connectionType === 'FTTH' ? 'FTTH Fibra' : 'WISP Radio')}
            {row('Zona / Ciudad', client.city, <MapPin className="w-3 h-3" />)}
            {row('Dirección', client.address)}
            {row('Teléfono / WhatsApp', client.phone, <Phone className="w-3 h-3" />)}
            {row('Email', client.email, <Mail className="w-3 h-3" />)}
            {row('Fecha instalación', client.installationDate, <CalendarClock className="w-3 h-3" />)}
            {row('GPS', hasGps ? <span className="font-mono">{client.lat}, {client.lng}</span> : 'Sin coordenadas')}
          </div>
        </section>

        {/* Acciones rápidas */}
        {actions.length > 0 && (
          <section aria-label="Acciones rápidas">
            <h4 className="mb-2 text-[10px] font-mono uppercase tracking-widest text-slate-500">Acciones rápidas</h4>
            <div className="grid grid-cols-2 gap-2">
              {actions.map((a) => (
                <button
                  key={a.key}
                  id={`client360-action-${a.key}`}
                  onClick={() => onAction(a.key, client)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                    a.tone === 'danger'
                      ? 'border-rose-500/30 bg-rose-600/10 text-rose-300 hover:bg-rose-600/20'
                      : a.tone === 'success'
                        ? 'border-emerald-500/30 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20'
                        : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {a.icon}<span>{a.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Historial reciente */}
        <section aria-label="Historial reciente">
          <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <History className="w-3 h-3" /> Historial reciente
          </h4>
          {history.length === 0 ? (
            <div id="client360-history-empty" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-6 text-center text-[12px] text-slate-500">
              No hay historial reciente para este cliente.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-900 bg-slate-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-200">{h.label}</p>
                    {h.detail && <p className="text-[10px] text-slate-500">{h.detail}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] font-mono text-slate-500">{h.date}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
