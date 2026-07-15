import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Globe,
  CreditCard,
  Ticket,
  Calendar,
  Receipt,
  HandCoins,
  Link2,
  Check,
  Copy,
  RefreshCw,
  AlertTriangle,
  Wifi,
  UserRound,
} from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';
import { getAppScope } from '../lib/appScope';
import { buildPortalShareUrl, readPortalClientIdFromSearch } from '../lib/portalLinks';
import { Client } from '../types';

interface PortalModuleProps {
  clients: Client[];
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const formatMXN = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(n) || 0);

const invoiceStatusLabel = (status: string): string => {
  switch (String(status || '').toLowerCase()) {
    case 'paid':
      return 'Pagada';
    case 'overdue':
      return 'Vencida';
    case 'pending':
    case 'issued':
      return 'Pendiente';
    case 'canceled':
    case 'cancelled':
      return 'Cancelada';
    default:
      return status || '—';
  }
};

export default function PortalModule({ clients, getAuthHeaders }: PortalModuleProps) {
  const scope = getAppScope();
  const isCustomerShell = scope === 'portal';

  const initialClientId = useMemo(() => {
    try {
      const fromUrl = readPortalClientIdFromSearch(window.location.search);
      if (fromUrl && clients.some((c) => c.id === fromUrl)) return fromUrl;
    } catch {
      /* no window */
    }
    const active = clients.find((c) => c.status === 'active');
    return active?.id ?? clients[0]?.id ?? '';
  }, [clients]);

  const [clientId, setClientId] = useState(initialClientId);
  const [summary, setSummary] = useState<{
    client?: { name?: string; status?: string };
    balance?: number;
    nextDue?: string | null;
    serviceStatus?: string;
  } | null>(null);
  const [invoices, setInvoices] = useState<Array<{ id: string; amount: number; status: string; dueDateStr?: string }>>([]);
  const [tickets, setTickets] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [promiseDate, setPromiseDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    return d.toISOString().split('T')[0];
  });
  const [promiseAmount, setPromiseAmount] = useState('');

  useEffect(() => {
    if (!clientId && initialClientId) setClientId(initialClientId);
  }, [clientId, initialClientId]);

  const selected = clients.find((c) => c.id === clientId) ?? null;
  const portalLink = useMemo(() => {
    if (!clientId) return '';
    try {
      return buildPortalShareUrl(window.location.origin, clientId);
    } catch {
      return '';
    }
  }, [clientId]);

  const loadAll = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const [sumRes, invRes, tktRes] = await Promise.all([
        fetchWithRateLimitBackoff(`/api/portal/${clientId}/summary`, { headers }),
        fetchWithRateLimitBackoff(`/api/portal/${clientId}/invoices`, { headers }),
        fetchWithRateLimitBackoff(`/api/portal/${clientId}/tickets`, { headers }),
      ]);
      if (!sumRes.ok) {
        const body = await sumRes.json().catch(() => ({}));
        throw new Error(body?.error || `No se pudo cargar la cuenta (${sumRes.status})`);
      }
      setSummary(await sumRes.json());
      if (invRes.ok) setInvoices(await invRes.json());
      if (tktRes.ok) setTickets(await tktRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar el portal');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, getAuthHeaders]);

  useEffect(() => {
    if (clientId) void loadAll();
  }, [clientId, loadAll]);

  const copyPortalLink = async () => {
    if (!portalLink) return;
    try {
      await navigator.clipboard.writeText(portalLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copia el enlace del portal:', portalLink);
    }
  };

  const reportTicket = async () => {
    if (!clientId) return;
    setActionMsg('');
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff(`/api/portal/${clientId}/tickets`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Falla reportada desde portal', description: 'Autoservicio del cliente' }),
    });
    setActionMsg(res.ok ? 'Ticket de falla creado.' : 'No se pudo crear el ticket.');
    void loadAll();
  };

  const submitPromise = async () => {
    if (!clientId || !promiseAmount) return;
    setActionMsg('');
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff(`/api/portal/${clientId}/payment-promise`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ promisedDate: promiseDate, amount: Number(promiseAmount) }),
    });
    setActionMsg(res.ok ? 'Promesa de pago registrada.' : 'No se pudo registrar la promesa.');
    setPromiseAmount('');
    void loadAll();
  };

  if (clients.length === 0) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-3">
          <Globe className="w-10 h-10 text-sky-400 mx-auto" />
          <h2 className="text-xl font-bold text-white tracking-tight">Portal del Cliente</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Aún no hay clientes en el sistema. Registra uno en CRM y aquí podrás copiar el enlace para compartírselo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[70vh]">
      {/* Atmósfera suave — alineada al shell NugaCore */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-56 w-56 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-2xl space-y-5 p-4 md:p-6 animate-[fadeIn_0.35s_ease-out]">
        {/* Marca + título */}
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-sky-400/90">NugaCore</p>
            <h2 className="mt-1 text-2xl md:text-3xl font-bold text-white tracking-tight">
              {isCustomerShell ? 'Mi cuenta' : 'Portal del Cliente'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {isCustomerShell
                ? 'Consulta saldo, facturas y reporta fallas.'
                : 'Vista previa y enlace para compartir con el abonado.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading || !clientId}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-[11px] font-mono text-slate-300 hover:border-slate-600 transition disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </header>

        {/* Acceso rápido: copiar enlace */}
        <section className="rounded-2xl border border-sky-500/25 bg-gradient-to-br from-sky-950/50 to-slate-950/80 p-4 md:p-5 shadow-[0_0_0_1px_rgba(14,165,233,0.08)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-sky-500/15 p-2.5 border border-sky-500/20">
              <Link2 className="w-5 h-5 text-sky-300" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-white">Enlace del portal</h3>
                <p className="text-[12px] text-slate-400 leading-snug mt-0.5">
                  Cópialo y envíalo al cliente (WhatsApp, SMS o correo). Al abrirlo entra a{' '}
                  <span className="text-sky-300/90 font-mono">/?app=portal</span> con su cuenta.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  readOnly
                  value={portalLink}
                  className="flex-1 truncate rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2.5 text-[11px] font-mono text-slate-300"
                  aria-label="URL del portal del cliente"
                />
                <button
                  id="copy-portal-link"
                  type="button"
                  onClick={() => void copyPortalLink()}
                  disabled={!portalLink}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? '¡Copiado!' : 'Copiar enlace'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Selector staff (oculto en shell puro cliente si hay un solo binding futuro; hoy útil para preview) */}
        {!isCustomerShell && (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <label className="text-[11px] uppercase tracking-wider font-mono text-slate-500 shrink-0">
              Cliente
            </label>
            <select
              id="portal-client-select"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setActionMsg('');
              }}
              className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-800/50 bg-rose-950/40 px-3 py-2.5 text-sm text-rose-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {actionMsg && (
          <p className="text-xs font-mono text-emerald-300/90 animate-[fadeIn_0.25s_ease-out]">{actionMsg}</p>
        )}

        {/* Cuenta */}
        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 overflow-hidden">
          <div className="border-b border-slate-800/80 px-4 md:px-5 py-4 flex items-center gap-3">
            <div className="rounded-full bg-slate-900 border border-slate-800 p-2">
              <UserRound className="w-5 h-5 text-slate-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white truncate">
                {summary?.client?.name || selected?.name || 'Cuenta'}
              </h3>
              <p className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
                <Wifi className="w-3 h-3" />
                {selected?.status ? `Estatus: ${selected.status}` : 'Servicio'}
                {selected?.planId ? ` · Plan ${selected.planId}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px bg-slate-800/60">
            <div className="bg-slate-950 px-4 py-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono uppercase tracking-wide">
                <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
                Saldo pendiente
              </div>
              <p className="mt-1 text-2xl font-bold text-white tracking-tight">
                {loading && !summary ? '…' : formatMXN(summary?.balance ?? 0)}
              </p>
            </div>
            <div className="bg-slate-950 px-4 py-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono uppercase tracking-wide">
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                Próximo vencimiento
              </div>
              <p className="mt-1 text-lg font-semibold text-white">
                {summary?.nextDue || '—'}
              </p>
            </div>
          </div>

          <div className="p-4 md:p-5 space-y-5">
            <button
              id="portal-report-ticket"
              type="button"
              onClick={() => void reportTicket()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-rose-700/40 bg-rose-950/35 hover:bg-rose-900/40 px-4 py-3 text-sm font-semibold text-rose-100 transition"
            >
              <Ticket className="w-4 h-4" />
              Reportar falla
            </button>

            <div>
              <h4 className="text-xs font-semibold text-white flex items-center gap-2 mb-2">
                <Receipt className="w-3.5 h-3.5 text-slate-400" />
                Mis facturas
              </h4>
              {invoices.length === 0 ? (
                <p className="text-xs text-slate-500 font-mono py-2">Sin facturas registradas.</p>
              ) : (
                <ul className="space-y-1.5">
                  {invoices.slice(0, 8).map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2.5 text-xs"
                    >
                      <span className="font-mono text-slate-400 truncate">{inv.id}</span>
                      <span
                        className={
                          String(inv.status).toLowerCase() === 'paid'
                            ? 'text-emerald-400 font-medium'
                            : 'text-amber-300 font-medium'
                        }
                      >
                        {formatMXN(inv.amount)} · {invoiceStatusLabel(inv.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-white flex items-center gap-2 mb-2">
                <Ticket className="w-3.5 h-3.5 text-slate-400" />
                Mis tickets
              </h4>
              {tickets.length === 0 ? (
                <p className="text-xs text-slate-500 font-mono py-2">Sin tickets abiertos.</p>
              ) : (
                <ul className="space-y-1.5">
                  {tickets.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2.5 text-xs"
                    >
                      <span className="text-slate-200 truncate">{t.title}</span>
                      <span className="uppercase font-mono text-slate-500 shrink-0">{t.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h4 className="text-xs font-semibold text-white flex items-center gap-2 mb-2">
                <HandCoins className="w-3.5 h-3.5 text-amber-400/90" />
                Promesa de pago
              </h4>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="date"
                  value={promiseDate}
                  onChange={(e) => setPromiseDate(e.target.value)}
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Monto MXN"
                  value={promiseAmount}
                  onChange={(e) => setPromiseAmount(e.target.value)}
                  className="sm:w-36 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white"
                />
                <button
                  id="portal-promise-submit"
                  type="button"
                  onClick={() => void submitPromise()}
                  disabled={!promiseAmount}
                  className="rounded-xl border border-amber-600/40 bg-amber-600/15 hover:bg-amber-600/25 px-4 py-2.5 text-sm font-semibold text-amber-100 transition disabled:opacity-40"
                >
                  Solicitar
                </button>
              </div>
            </div>
          </div>
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
