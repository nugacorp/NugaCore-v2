import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, MapPin, Phone, Mail, Wifi, Router as RouterIcon, CalendarClock,
  CreditCard, Ticket, UserMinus, CheckCircle, Pencil, Network, Navigation, History,
  Wallet, Receipt, FileText, AlertTriangle, ClipboardList, Brain, Bell,
  Tag, Users, Paperclip, Loader2, Plus, Send, Download, Trash2, FileWarning,
} from 'lucide-react';
import { Client } from '../types';
import { ClientActionCaps } from '../lib/rbac';
import { ClientQuickAction } from './ClientActionsMenu';
import { createAuthorizedApi } from '../lib/apiClient';
import DocumentUploadControl from './DocumentUploadControl';
import { DOC_TYPE_LABEL, describeDeletion, hasStoredFile } from '../lib/documentUpload';

// Resumen de cobranza del cliente (FASE D — Billing Foundation).
// Proyección de GET /api/billing/customers/:customerId/balance. Opcional:
// el panel funciona aunque no haya datos de billing cargados.
export interface ClientBillingSummary {
  currentBalance: number;
  overdueBalance: number;
  pendingInvoices: number;
  overdueInvoices: number;
  lastPaymentAmount: number | null;
  lastPaymentDate: string | null;
}

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

// Estado oficial de servicio (Pre-PROD-7). Proyección de
// GET /api/service-status/customers/:customerId. Las 4 dimensiones se muestran
// SIN mezclarse: administrativo (CRM), financiero, operativo y de red.
export interface ClientServiceStatusView {
  customerStatus: string;
  billingStatus: string;
  serviceStatus: string;
  routerStatus: string | null;
}

export interface ClientProvisioningView {
  lastAction: string;
  status: string;
  date: string;
  simulationResult?: string;
}

// Historial de Automation (PROD-8 / FASE K). Proyección descriptiva del
// Automation Engine para el cliente: últimos eventos, decisiones propuestas
// y última simulación. NO contiene acciones reales (todo es dry-run).
export interface ClientAutomationView {
  lastEvents: string[];
  lastDecisions: string[];
  lastSimulation: string;
}

// Notificaciones del cliente (PROD-9 / FASE L). Proyección descriptiva del
// Notification Engine: últimos previews, último recordatorio, canal y estado.
// Todo dry-run: nunca representa un envío real.
export interface ClientNotificationsView {
  lastPreviews: string[];
  lastReminder: string;
  channel: string;
  status: string;
}

export interface Client360Tag {
  id: string;
  label: string;
  color: string;
  createdAt: string;
}

export interface Client360Contact {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  channel: string;
  isPrimary: boolean;
}

export interface Client360Document {
  id: string;
  docType: string;
  fileName: string;
  createdAt: string;
  /** Ausente en las filas que dejó el `addDocument()` anterior, que no subía
   *  ningún archivo. Se marcan en la lista; ocultarlas taparía el rastro. */
  storagePath?: string;
  mimeType?: string;
}

export interface Client360Activity {
  id: string;
  action: string;
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  actorRole?: string;
  createdAt: string;
}

export interface Client360Expediente {
  tags: Client360Tag[];
  contacts: Client360Contact[];
  documents: Client360Document[];
  activity: Client360Activity[];
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
  billing?: ClientBillingSummary | null;
  serviceStatus?: ClientServiceStatusView | null;
  provisioning?: ClientProvisioningView | null;
  automation?: ClientAutomationView | null;
  notifications?: ClientNotificationsView | null;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onAction: (action: ClientQuickAction, client: Client) => void;
  onClose: () => void;
}

const money = (v: number): string =>
  `$${(Number.isFinite(v) ? v : 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Acciones de cobranza del panel (FASE D). Read-only / navegación / modal mock.
// NO incluye suspender ni reactivar (esas viven en QUICK_ACTIONS generales).
const BILLING_ACTIONS: { key: ClientQuickAction; label: string; cap: keyof ClientActionCaps; icon: React.ReactNode }[] = [
  { key: 'view-invoices', label: 'Ver facturas', cap: 'accountStatement', icon: <Receipt className="w-3.5 h-3.5" /> },
  { key: 'register-payment', label: 'Registrar pago', cap: 'registerPayment', icon: <CreditCard className="w-3.5 h-3.5" /> },
  { key: 'account-statement', label: 'Ver estado de cuenta', cap: 'accountStatement', icon: <FileText className="w-3.5 h-3.5" /> },
];

export default function Client360Panel({
  client, planName, caps, history, billing, serviceStatus, provisioning, automation, notifications,
  getAuthHeaders, onAction, onClose,
}: Props) {
  const ip = client.assignedIp || client.ip;
  const hasIp = ip && ip !== '0.0.0.0';
  const hasGps = Number.isFinite(client.lat) && Number.isFinite(client.lng) && !(client.lat === 0 && client.lng === 0);

  const [expediente, setExpediente] = useState<Client360Expediente | null>(null);
  const [expedienteLoading, setExpedienteLoading] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [docNotice, setDocNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notifyChannel, setNotifyChannel] = useState(client.notificationChannel || 'whatsapp');
  const [telegramChatId, setTelegramChatId] = useState(client.telegramChatId || '');

  useEffect(() => {
    setNotifyChannel(client.notificationChannel || 'whatsapp');
    setTelegramChatId(client.telegramChatId || '');
  }, [client.id, client.notificationChannel, client.telegramChatId]);

  const saveNotificationPrefs = async () => {
    setBusy(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.put(`/api/clients/${client.id}`, {
        notificationChannel: notifyChannel,
        telegramChatId: notifyChannel === 'telegram' ? telegramChatId : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const loadExpediente = useCallback(async () => {
    setExpedienteLoading(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const data = await api.get<Client360Expediente>(`/api/clients/${client.id}/expediente`);
      setExpediente(data);
    } catch {
      setExpediente(null);
    } finally {
      setExpedienteLoading(false);
    }
  }, [client.id, getAuthHeaders]);

  useEffect(() => {
    void loadExpediente();
  }, [loadExpediente]);

  const addTag = async () => {
    const label = newTag.trim();
    if (!label) return;
    setBusy(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.post(`/api/clients/${client.id}/tags`, { label });
      setNewTag('');
      await loadExpediente();
    } finally {
      setBusy(false);
    }
  };

  // El transporte del CRM. `DocumentUploadControl` lo recibe por parámetro y no
  // importa ningún cliente HTTP: la PWA del técnico le pasará el suyo, que sí
  // lleva backoff de 429.
  const documentTransport = useMemo(() => createAuthorizedApi(getAuthHeaders), [getAuthHeaders]);

  const downloadDocument = async (doc: Client360Document) => {
    setDocNotice(null);
    setBusy(true);
    try {
      const { url } = await documentTransport.get<{ url: string }>(
        `/api/clients/${client.id}/documents/${doc.id}/download-url`,
      );
      // El bucket es privado: esta URL es firmada y de vida corta.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setDocNotice('No se pudo obtener el enlace de descarga.');
    } finally {
      setBusy(false);
    }
  };

  const removeDocument = async (doc: Client360Document) => {
    setDocNotice(null);
    setBusy(true);
    try {
      const result = await documentTransport.delete<{
        objectRemoved?: boolean;
        objectRetainedReason?: string | null;
      }>(`/api/clients/${client.id}/documents/${doc.id}`);
      // El backend puede quitar la fila y dejar el objeto (contrato, ruta
      // compartida…). Decirlo evita que el usuario crea que el archivo se fue.
      setDocNotice(describeDeletion(result));
      await loadExpediente();
    } catch (err) {
      setDocNotice(err instanceof Error ? err.message : 'No se pudo eliminar el documento.');
    } finally {
      setBusy(false);
    }
  };

  const actions = QUICK_ACTIONS.filter((a) => caps[a.cap] && (!a.show || a.show(client)));
  const billingActions = BILLING_ACTIONS.filter((a) => caps[a.cap]);

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
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase ${STATUS_BADGE[client.status]}`}>
                {STATUS_LABEL[client.status]}
              </span>
              <span className="text-[10px] font-mono text-slate-500 uppercase">ID: {client.id}</span>
              {expediente?.tags.map((t) => (
                <span key={t.id} className="px-2 py-0.5 rounded text-[10px] font-mono border" style={{ borderColor: t.color, color: t.color }}>
                  {t.label}
                </span>
              ))}
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
            {row(
              'Canal de facturación',
              client.notificationChannel || 'whatsapp',
              <Bell className="w-3 h-3" />,
            )}
            {client.notificationChannel === 'telegram' &&
              row('Telegram chat ID', client.telegramChatId || 'Sin configurar', <Send className="w-3 h-3" />)}
            {caps.editClient && (
              <div className="pt-2 space-y-2 border-t border-slate-900/80 mt-2">
                <p className="text-[10px] font-mono uppercase text-slate-500">Preferencia de avisos</p>
                <select
                  value={notifyChannel}
                  onChange={(e) => setNotifyChannel(e.target.value as Client['notificationChannel'])}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="telegram">Telegram</option>
                  <option value="sms">SMS (vía WhatsApp API)</option>
                  <option value="email">Email (pendiente SMTP)</option>
                </select>
                {notifyChannel === 'telegram' && (
                  <input
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="Chat ID de Telegram"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-white"
                  />
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveNotificationPrefs()}
                  className="text-[10px] font-mono text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
                >
                  Guardar canal de facturación
                </button>
              </div>
            )}
            {row('Fecha instalación', client.installationDate, <CalendarClock className="w-3 h-3" />)}
            {row('GPS', hasGps ? <span className="font-mono">{client.lat}, {client.lng}</span> : 'Sin coordenadas')}
          </div>
        </section>

        {/* Expediente — etiquetas, contactos, documentos, auditoría */}
        <section aria-label="Expediente">
          <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <ClipboardList className="w-3 h-3" /> Expediente
            {expedienteLoading && <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />}
          </h4>
          <div id="client360-expediente" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-3 space-y-3">
            <div>
              <p className="text-[10px] font-mono uppercase text-slate-500 mb-1 flex items-center gap-1"><Tag className="w-3 h-3" /> Etiquetas</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {(expediente?.tags ?? []).map((t) => (
                  <span key={t.id} className="px-2 py-0.5 rounded text-[10px] font-mono" style={{ backgroundColor: `${t.color}22`, color: t.color }}>{t.label}</span>
                ))}
                {(!expediente?.tags || expediente.tags.length === 0) && <span className="text-[11px] text-slate-500">Sin etiquetas</span>}
              </div>
              {caps.editClient && (
                <div className="flex gap-2">
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta" className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px]" />
                  <button type="button" disabled={busy} onClick={() => void addTag()} className="px-2 py-1 rounded-lg bg-indigo-600/20 text-indigo-300 text-[10px]"><Plus className="w-3 h-3" /></button>
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-slate-500 mb-1 flex items-center gap-1"><Users className="w-3 h-3" /> Contactos alternos</p>
              {(expediente?.contacts ?? []).length === 0 ? (
                <p className="text-[11px] text-slate-500">Sin contactos alternos</p>
              ) : (
                <ul className="space-y-1">
                  {expediente!.contacts.map((c) => (
                    <li key={c.id} className="text-[11px] text-slate-300">{c.name || 'Contacto'} · {c.phone || c.email} ({c.channel})</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-slate-500 mb-1 flex items-center gap-1"><Paperclip className="w-3 h-3" /> Documentos</p>
              {(expediente?.documents ?? []).length === 0 ? (
                <p className="text-[11px] text-slate-500">Sin documentos</p>
              ) : (
                <ul id="client360-documents" className="space-y-1">
                  {expediente!.documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                      <span className="min-w-0 truncate">
                        {d.fileName} <span className="text-slate-500">({DOC_TYPE_LABEL[d.docType] ?? d.docType})</span>
                        {!hasStoredFile(d) && (
                          // Fila que quedó del flujo anterior: registro sin
                          // archivo. Se marca en vez de ocultarla, y sin botón
                          // de descarga: daría un 404 sin explicación.
                          <span
                            id={`client360-document-nofile-${d.id}`}
                            className="ml-1 inline-flex items-center gap-0.5 text-amber-500"
                          >
                            <FileWarning className="w-3 h-3" /> sin archivo
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {hasStoredFile(d) && (
                          <button
                            type="button"
                            id={`client360-document-download-${d.id}`}
                            aria-label={`Descargar ${d.fileName}`}
                            disabled={busy}
                            onClick={() => void downloadDocument(d)}
                            className="text-slate-400 hover:text-indigo-300 disabled:opacity-50"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                        {caps.manageDocuments && (
                          <button
                            type="button"
                            id={`client360-document-delete-${d.id}`}
                            aria-label={`Eliminar ${d.fileName}`}
                            disabled={busy}
                            onClick={() => void removeDocument(d)}
                            className="text-slate-400 hover:text-rose-400 disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {docNotice && (
                <p id="client360-document-notice" className="mt-1 text-[10px] text-slate-400">{docNotice}</p>
              )}
              {caps.manageDocuments && (
                <div className="mt-2">
                  <DocumentUploadControl
                    clientId={client.id}
                    transport={documentTransport}
                    idPrefix="client360-document-upload"
                    disabled={busy}
                    onUploaded={() => loadExpediente()}
                  />
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase text-slate-500 mb-1 flex items-center gap-1"><History className="w-3 h-3" /> Actividad auditada</p>
              {(expediente?.activity ?? []).length === 0 ? (
                <p className="text-[11px] text-slate-500">Sin actividad registrada</p>
              ) : (
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {expediente!.activity.slice(0, 8).map((a) => (
                    <li key={a.id} className="text-[10px] text-slate-400">
                      <span className="text-slate-300">{a.action}</span>
                      {a.newValue && <> → {a.newValue}</>}
                      <span className="text-slate-600 ml-1">{a.createdAt.substring(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* Estado de servicio (Pre-PROD-7 — Service Status SSOT) */}
        {serviceStatus && (
          <section aria-label="Estado de servicio">
            <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
              <Wifi className="w-3 h-3" /> Estado de servicio
            </h4>
            <div id="client360-service-status" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-2 divide-y divide-slate-900/70">
              {row('Estado CRM', <span className="font-mono uppercase">{serviceStatus.customerStatus}</span>)}
              {row('Estado cobranza', <span className="font-mono uppercase">{serviceStatus.billingStatus}</span>)}
              {row('Estado de servicio', <span className="font-mono uppercase text-indigo-300">{serviceStatus.serviceStatus}</span>)}
              {row('Estado en red (router)', serviceStatus.routerStatus || 'No disponible')}
            </div>
          </section>
        )}

        {/* Provisioning (PROD-7 foundation, dry-run) */}
        <section aria-label="Provisioning">
          <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <ClipboardList className="w-3 h-3" /> Provisioning
          </h4>
          <div id="client360-provisioning" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-2 divide-y divide-slate-900/70">
            {row('Última acción', provisioning?.lastAction || 'Sin acciones registradas')}
            {row('Estado', provisioning ? <span className="font-mono uppercase text-indigo-300">{provisioning.status}</span> : '—')}
            {row('Fecha', provisioning?.date || '—')}
            {row('Resultado simulación', provisioning?.simulationResult || 'Pendiente')}
          </div>
          <button
            type="button"
            id="client360-provisioning-history"
            onClick={() => onAction('view-history', client)}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800"
          >
            <History className="w-3.5 h-3.5" />
            <span>Ver historial</span>
          </button>
        </section>

        {/* Automation History (PROD-8 / FASE K, dry-run) */}
        <section aria-label="Automation">
          <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <Brain className="w-3 h-3" /> Automation
          </h4>
          <div id="client360-automation" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-2 divide-y divide-slate-900/70">
            {row('Últimos eventos', automation?.lastEvents?.length
              ? <span className="font-mono text-[10px] text-slate-300">{automation.lastEvents.join(', ')}</span>
              : 'Sin eventos')}
            {row('Últimas decisiones', automation?.lastDecisions?.length
              ? <span className="font-mono text-[10px] text-indigo-300">{automation.lastDecisions.join(', ')}</span>
              : 'Sin decisiones')}
            {row('Última simulación', automation?.lastSimulation || 'Pendiente')}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">El motor solo propone decisiones (dry-run). No ejecuta acciones.</p>
        </section>

        {/* Notificaciones (PROD-9 / FASE L, dry-run) */}
        <section aria-label="Notificaciones">
          <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <Bell className="w-3 h-3" /> Notificaciones
          </h4>
          <div id="client360-notifications" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-2 divide-y divide-slate-900/70">
            {row('Último recordatorio', notifications?.lastReminder || 'Sin recordatorios')}
            {row('Canal', notifications?.channel ? <span className="font-mono uppercase text-indigo-300">{notifications.channel}</span> : '—')}
            {row('Estado', notifications?.status ? <span className="font-mono uppercase text-indigo-300">{notifications.status}</span> : '—')}
            {row('Últimos previews', notifications?.lastPreviews?.length
              ? <span className="font-mono text-[10px] text-slate-300">{notifications.lastPreviews.join(', ')}</span>
              : 'Sin previews')}
          </div>
          <button
            type="button"
            id="client360-create-payment-reminder"
            onClick={() => onAction('create-payment-reminder', client)}
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Crear recordatorio de pago</span>
          </button>
          <p className="mt-1 text-[10px] text-slate-500">Crea una simulación dry-run. No se envían mensajes reales.</p>
        </section>

        {/* Cobranza (FASE D — Billing Foundation) */}
        <section aria-label="Cobranza">
          <h4 className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-slate-500">
            <Wallet className="w-3 h-3" /> Cobranza
          </h4>
          <div id="client360-billing" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-2 divide-y divide-slate-900/70">
            {row(
              'Saldo actual',
              <span className={`font-mono ${billing && billing.currentBalance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {billing ? money(billing.currentBalance) : '—'}
              </span>,
              <Wallet className="w-3 h-3" />,
            )}
            {row(
              'Saldo vencido',
              <span className={`font-mono ${billing && billing.overdueBalance > 0 ? 'text-rose-400' : 'text-slate-200'}`}>
                {billing ? money(billing.overdueBalance) : '—'}
              </span>,
              <AlertTriangle className="w-3 h-3" />,
            )}
            {row('Facturas pendientes', billing ? String(billing.pendingInvoices) : '—', <Receipt className="w-3 h-3" />)}
            {row('Facturas vencidas', billing ? String(billing.overdueInvoices) : '—', <AlertTriangle className="w-3 h-3" />)}
            {row('Último pago', billing && billing.lastPaymentAmount != null ? money(billing.lastPaymentAmount) : 'Sin pagos', <CreditCard className="w-3 h-3" />)}
            {row('Fecha último pago', billing?.lastPaymentDate || '—', <CalendarClock className="w-3 h-3" />)}
          </div>
          {billingActions.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {billingActions.map((a) => (
                <button
                  key={a.key}
                  id={`client360-billing-${a.key}`}
                  onClick={() => onAction(a.key, client)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800"
                >
                  {a.icon}<span>{a.label}</span>
                </button>
              ))}
            </div>
          )}
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
          {(() => {
            const auditHistory = (expediente?.activity ?? []).map((a) => ({
              id: a.id,
              kind: 'evento' as const,
              label: a.action,
              detail: a.newValue || a.oldValue,
              date: a.createdAt.substring(0, 16).replace('T', ' '),
            }));
            const merged = [...auditHistory, ...history].slice(0, 12);
            if (merged.length === 0) {
              return (
            <div id="client360-history-empty" className="rounded-2xl border border-slate-900 bg-slate-900/40 px-4 py-6 text-center text-[12px] text-slate-500">
              No hay historial reciente para este cliente.
            </div>
              );
            }
            return (
            <ul className="space-y-1.5">
              {merged.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-900 bg-slate-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[12px] text-slate-200">{h.label}</p>
                    {h.detail && <p className="text-[10px] text-slate-500">{h.detail}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] font-mono text-slate-500">{h.date}</span>
                </li>
              ))}
            </ul>
            );
          })()}
        </section>
      </div>
    </div>
  );
}
