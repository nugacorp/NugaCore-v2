import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Eye, ListChecks, MessageSquare, PlayCircle, RefreshCw, Radio, XCircle } from 'lucide-react';
import type { UserRole } from '../../lib/supabase';
import { canWriteNotifications } from '../../lib/notificationsRbac';

// ====================================================================
// Notification Center (PROD-9) — DRY RUN / MOCK PROVIDER.
//
// Las notificaciones están en modo simulación. No se envían mensajes
// reales. Solo vista previa, simulación y cancelación.
// ====================================================================

type NotificationType =
  | 'PAYMENT_REMINDER' | 'INVOICE_OVERDUE' | 'SERVICE_SUSPENSION_PENDING'
  | 'SERVICE_REACTIVATION_PENDING' | 'NOC_ALERT' | 'TICKET_UPDATE'
  | 'INSTALLATION_REMINDER' | 'PROVISIONING_STATUS' | 'SYSTEM_ALERT';
type NotificationChannel = 'WHATSAPP' | 'TELEGRAM' | 'EMAIL' | 'PUSH' | 'IN_APP';
type NotificationStatus = 'DRAFT' | 'QUEUED' | 'SIMULATED' | 'SENT' | 'FAILED' | 'CANCELLED';

interface Template {
  id: string;
  type: NotificationType;
  name: string;
  channelDefault: NotificationChannel;
  body: string;
  variables: string[];
}

interface NotificationMessage {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  customerId?: string;
  customerName?: string;
  templateId: string;
  renderedBody: string;
  status: NotificationStatus;
  source: string;
  provider: 'mock';
  dryRun: true;
  sent: false;
  createdAt: string;
  simulationResult?: string;
}

interface Summary {
  totalMessages: number;
  draft: number;
  queued: number;
  simulated: number;
  cancelled: number;
  failed: number;
  pending: number;
  supportedTypes: number;
  supportedChannels: number;
  templates: number;
  dryRun: true;
}

interface PreviewResult {
  type: NotificationType;
  channel: NotificationChannel;
  templateId: string;
  renderedBody: string;
  provider: 'mock';
  dryRun: true;
  wouldSend: true;
  sent: false;
}

interface Props {
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

type Screen = 'resumen' | 'templates' | 'mensajes' | 'simulaciones' | 'canales';

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'templates', label: 'Templates' },
  { id: 'mensajes', label: 'Mensajes' },
  { id: 'simulaciones', label: 'Simulaciones' },
  { id: 'canales', label: 'Canales' },
];

const CHANNELS: NotificationChannel[] = ['WHATSAPP', 'TELEGRAM', 'EMAIL', 'PUSH', 'IN_APP'];

const STATUS_STYLE: Record<NotificationStatus, string> = {
  DRAFT: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  QUEUED: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  SIMULATED: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200',
  SENT: 'border-slate-700 bg-slate-900 text-slate-400',
  FAILED: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  CANCELLED: 'border-slate-700 bg-slate-900 text-slate-400',
};

export default function NotificationCenterModule({ userRole, getAuthHeaders }: Props) {
  const [screen, setScreen] = useState<Screen>('resumen');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [messages, setMessages] = useState<NotificationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [previewBody, setPreviewBody] = useState<PreviewResult | null>(null);
  const canWrite = canWriteNotifications(userRole);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const [s, t, m] = await Promise.all([
        fetch('/api/notifications/summary', { headers }),
        fetch('/api/notifications/templates', { headers }),
        fetch('/api/notifications/messages', { headers }),
      ]);
      if (!s.ok || !t.ok || !m.ok) throw new Error('HTTP');
      setSummary(await s.json());
      const tpls = await t.json();
      setTemplates(tpls);
      setMessages(await m.json());
      if (!selectedTemplate && tpls[0]) setSelectedTemplate(tpls[0].type);
      setNotice('');
    } catch {
      setNotice('No se pudo cargar el Notification Center.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, selectedTemplate]);

  useEffect(() => { void load(); }, [load]);

  const guarded = (fn: () => Promise<void>) => async () => {
    if (!canWrite) {
      setNotice('Tu rol tiene acceso de lectura al Notification Center.');
      return;
    }
    await fn();
  };

  const doPreview = guarded(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/notifications/preview', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: selectedTemplate, variables: { customerName: 'Cliente Demo', amount: '$500.00', dueDate: '2026-07-01' } }),
    });
    if (!res.ok) { setNotice('No se pudo generar la vista previa.'); return; }
    setPreviewBody(await res.json());
    setScreen('simulaciones');
    setNotice('');
  });

  const createDraft = guarded(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/notifications/messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: selectedTemplate, variables: { customerName: 'Cliente Demo', amount: '$500.00', dueDate: '2026-07-01' } }),
    });
    if (!res.ok) { setNotice('No se pudo crear el borrador.'); return; }
    setNotice('');
    void load();
  });

  const mutate = (id: string, op: 'simulate' | 'cancel') => guarded(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/notifications/messages/${id}/${op}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: op === 'cancel' ? JSON.stringify({ reason: 'Cancelado desde Notification Center.' }) : '{}',
    });
    if (!res.ok) { setNotice('No se pudo aplicar la acción.'); return; }
    const updated = await res.json();
    setMessages((prev) => prev.map((item) => item.id === updated.id ? updated : item));
    setNotice('');
    void load();
  });

  const simulations = useMemo(() => messages.filter((m) => m.status === 'SIMULATED'), [messages]);

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-800 pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-indigo-400" />
            <h2 className="text-2xl font-bold tracking-tight text-white">Notification Center</h2>
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">DRY RUN</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">Centraliza notificaciones de Cobranza, NOC, Tickets, Automation y Provisioning.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {/* Banner obligatorio (FASE K) */}
      <div className="mb-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs text-indigo-200">
        Las notificaciones están en modo simulación. No se envían mensajes reales.
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">{notice}</div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScreen(s.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              screen === s.id
                ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {screen === 'resumen' && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: 'Mensajes', value: summary?.totalMessages ?? 0, icon: MessageSquare },
            { label: 'Borradores', value: summary?.draft ?? 0, icon: ListChecks },
            { label: 'Simulados', value: summary?.simulated ?? 0, icon: PlayCircle },
            { label: 'Pendientes', value: summary?.pending ?? 0, icon: Bell },
            { label: 'Canales', value: summary?.supportedChannels ?? 0, icon: Radio },
            { label: 'Templates', value: summary?.templates ?? 0, icon: Eye },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <kpi.icon className="mb-2 h-4 w-4 text-indigo-400" />
              <div className="text-2xl font-bold text-white">{kpi.value}</div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500">{kpi.label}</div>
            </div>
          ))}
        </section>
      )}

      {screen === 'templates' && (
        <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-end">
            <label className="flex-1 text-[11px] text-slate-400">
              Plantilla
              <select
                value={selectedTemplate}
                onChange={(ev) => setSelectedTemplate(ev.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
              >
                {templates.map((t) => <option key={t.id} value={t.type}>{t.name}</option>)}
              </select>
            </label>
            {canWrite && (
              <div className="flex gap-2">
                <button type="button" onClick={doPreview} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25">
                  <Eye className="h-3.5 w-3.5" /> Vista previa
                </button>
                <button type="button" onClick={createDraft} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
                  <MessageSquare className="h-3.5 w-3.5" /> Crear borrador
                </button>
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
                <tr><th className="px-4 py-3">Plantilla</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Canal</th><th className="px-4 py-3">Cuerpo</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-900/70">
                    <td className="px-4 py-3 font-semibold text-slate-200">{t.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{t.type}</td>
                    <td className="px-4 py-3 font-mono text-indigo-300">{t.channelDefault}</td>
                    <td className="px-4 py-3 text-slate-400">{t.body}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(screen === 'mensajes' || screen === 'simulaciones') && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {(screen === 'simulaciones' ? simulations : messages).length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={5}>Sin mensajes.</td></tr>
              ) : (screen === 'simulaciones' ? simulations : messages).map((m) => (
                <tr key={m.id} className="hover:bg-slate-900/70">
                  <td className="px-4 py-3 font-mono text-slate-300">{m.type}</td>
                  <td className="px-4 py-3 font-mono text-indigo-300">{m.channel}</td>
                  <td className="px-4 py-3 text-slate-300">{m.customerName || m.customerId || '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[m.status]}`}>{m.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button type="button" disabled={!canWrite || !['DRAFT', 'QUEUED'].includes(m.status)} onClick={mutate(m.id, 'simulate')} className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">
                        <PlayCircle className="h-3 w-3" /> Simular
                      </button>
                      <button type="button" disabled={!canWrite || m.status === 'CANCELLED'} onClick={mutate(m.id, 'cancel')} className="inline-flex items-center gap-1 rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-40">
                        <XCircle className="h-3 w-3" /> Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {screen === 'simulaciones' && previewBody && (
            <div className="border-t border-slate-800 p-4 text-xs">
              <div className="mb-1 font-bold text-white">Última vista previa ({previewBody.channel})</div>
              <p className="rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-2 text-slate-300">{previewBody.renderedBody}</p>
              <p className="mt-2 text-[11px] text-slate-500">provider=mock · wouldSend=true · sent=false · dryRun=true</p>
            </div>
          )}
        </section>
      )}

      {screen === 'canales' && (
        <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">Canales (mock providers)</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {CHANNELS.map((c) => (
              <div key={c} className="rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-3 text-center">
                <Radio className="mx-auto mb-1 h-4 w-4 text-indigo-400" />
                <div className="font-mono text-[11px] text-slate-300">{c}</div>
                <div className="mt-1 text-[10px] text-slate-500">mock · dry-run</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
