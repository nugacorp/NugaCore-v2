import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Key,
  CreditCard,
  MessageCircle,
  Send,
  QrCode,
  Router,
  Wallet,
  Save,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Webhook,
} from 'lucide-react';
import type { WispIntegrationsSettings } from '../../types';
import { openpayWebhookView } from '../../lib/integrationsView';

interface ExternalIntegrationsPanelProps {
  getAuthHeaders?: () => Promise<Record<string, string>>;
}

type ServiceKey = 'stripe' | 'whatsapp' | 'telegram' | 'codi' | 'openpay';

const statusClass = (configured: boolean, enabled: boolean) => {
  if (enabled && configured) return 'text-emerald-400';
  if (enabled && !configured) return 'text-amber-400';
  return 'text-slate-500';
};

/** Formulario de integraciones externas por WISP (sin datos mock). */
export default function ExternalIntegrationsPanel({ getAuthHeaders }: ExternalIntegrationsPanelProps) {
  const [settings, setSettings] = useState<WispIntegrationsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [active, setActive] = useState<ServiceKey>('stripe');
  const [webhookCopied, setWebhookCopied] = useState(false);

  const [stripe, setStripe] = useState({ enabled: false, publishableKey: '', secretKey: '', webhookSecret: '' });
  const [whatsapp, setWhatsapp] = useState({
    enabled: false,
    phoneNumberId: '',
    accessToken: '',
    businessAccountId: '',
    webhookVerifyToken: '',
  });
  const [telegram, setTelegram] = useState({ enabled: false, botUsername: '', botToken: '' });
  const [codi, setCodi] = useState({
    enabled: false,
    merchantId: '',
    beneficiaryName: '',
    clabe: '',
    webhookSecret: '',
    certificateRef: '',
  });
  const [openpay, setOpenpay] = useState({
    enabled: false,
    merchantId: '',
    publicKey: '',
    privateKey: '',
    webhookSecret: '',
    sandbox: true,
  });

  const load = useCallback(async () => {
    try {
      const headers = (await getAuthHeaders?.()) ?? {};
      const res = await fetch('/api/integrations/settings', { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as WispIntegrationsSettings;
      setSettings(data);
      setStripe({
        enabled: data.stripe.enabled,
        publishableKey: data.stripe.publishableKey,
        secretKey: '',
        webhookSecret: '',
      });
      setWhatsapp({
        enabled: data.whatsapp.enabled,
        phoneNumberId: data.whatsapp.phoneNumberId,
        accessToken: '',
        businessAccountId: data.whatsapp.businessAccountId,
        webhookVerifyToken: '',
      });
      setTelegram({
        enabled: data.telegram.enabled,
        botUsername: data.telegram.botUsername,
        botToken: '',
      });
      setCodi({
        enabled: data.codi.enabled,
        merchantId: data.codi.merchantId,
        beneficiaryName: data.codi.beneficiaryName,
        clabe: data.codi.clabe,
        webhookSecret: '',
        certificateRef: data.codi.certificateRef,
      });
      setOpenpay({
        enabled: data.openpay.enabled,
        merchantId: data.openpay.merchantId,
        publicKey: data.openpay.publicKey,
        privateKey: '',
        webhookSecret: '',
        sandbox: data.openpay.sandbox,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar integraciones');
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...((await getAuthHeaders?.()) ?? {}),
      };
      const body = {
        stripe: {
          enabled: stripe.enabled,
          publishableKey: stripe.publishableKey,
          ...(stripe.secretKey ? { secretKey: stripe.secretKey } : {}),
          ...(stripe.webhookSecret ? { webhookSecret: stripe.webhookSecret } : {}),
        },
        whatsapp: {
          enabled: whatsapp.enabled,
          phoneNumberId: whatsapp.phoneNumberId,
          businessAccountId: whatsapp.businessAccountId,
          ...(whatsapp.accessToken ? { accessToken: whatsapp.accessToken } : {}),
          ...(whatsapp.webhookVerifyToken ? { webhookVerifyToken: whatsapp.webhookVerifyToken } : {}),
        },
        telegram: {
          enabled: telegram.enabled,
          botUsername: telegram.botUsername,
          ...(telegram.botToken ? { botToken: telegram.botToken } : {}),
        },
        codi: {
          enabled: codi.enabled,
          merchantId: codi.merchantId,
          beneficiaryName: codi.beneficiaryName,
          clabe: codi.clabe,
          certificateRef: codi.certificateRef,
          ...(codi.webhookSecret ? { webhookSecret: codi.webhookSecret } : {}),
        },
        openpay: {
          enabled: openpay.enabled,
          merchantId: openpay.merchantId,
          publicKey: openpay.publicKey,
          sandbox: openpay.sandbox,
          ...(openpay.privateKey ? { privateKey: openpay.privateKey } : {}),
          ...(openpay.webhookSecret ? { webhookSecret: openpay.webhookSecret } : {}),
        },
      };
      const res = await fetch('/api/integrations/settings', { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as WispIntegrationsSettings;
      setSettings(data);
      setStripe((s) => ({ ...s, secretKey: '', webhookSecret: '' }));
      setWhatsapp((w) => ({ ...w, accessToken: '', webhookVerifyToken: '' }));
      setTelegram((t) => ({ ...t, botToken: '' }));
      setCodi((c) => ({ ...c, webhookSecret: '' }));
      setOpenpay((o) => ({ ...o, privateKey: '', webhookSecret: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setBusy(false);
    }
  };

  const test = async (provider: ServiceKey) => {
    setBusy(true);
    setTestResult(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...((await getAuthHeaders?.()) ?? {}),
      };
      const res = await fetch(`/api/integrations/test/${provider}`, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      setTestResult(
        (data as { sent?: boolean; preview?: string; error?: string }).sent
          ? `OK: ${(data as { preview?: string }).preview || provider}`
          : `Fallo: ${(data as { error?: string }).error || 'sin detalle'}`,
      );
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : 'Prueba fallida');
    } finally {
      setBusy(false);
    }
  };

  // La URL de webhook SIEMPRE se deriva del `webhookPath` que entrega el
  // backend (token opaco del WISP): aquí no se fabrica ninguna ruta ni token.
  const webhook = useMemo(
    () =>
      openpayWebhookView({
        origin: typeof window === 'undefined' ? '' : window.location.origin,
        webhookPath: settings?.openpay.webhookPath ?? '',
        enabled: settings?.openpay.enabled ?? false,
      }),
    [settings?.openpay.webhookPath, settings?.openpay.enabled],
  );

  const copyWebhookUrl = async () => {
    if (!webhook.available) return;
    try {
      await navigator.clipboard.writeText(webhook.url);
      setWebhookCopied(true);
      window.setTimeout(() => setWebhookCopied(false), 2000);
    } catch {
      window.prompt('Copia la URL del webhook de OpenPay:', webhook.url);
    }
  };

  const tabs: Array<{ id: ServiceKey; label: string; icon: React.ReactNode }> = [
    { id: 'stripe', label: 'Stripe', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { id: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle className="w-3.5 h-3.5" /> },
    { id: 'telegram', label: 'Telegram', icon: <Send className="w-3.5 h-3.5" /> },
    { id: 'codi', label: 'CoDi', icon: <QrCode className="w-3.5 h-3.5" /> },
    { id: 'openpay', label: 'OpenPay', icon: <Wallet className="w-3.5 h-3.5" /> },
  ];

  return (
    <div id="external-integrations-panel" className="bg-slate-950 border border-slate-800 p-5 rounded-2xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-900 pb-3">
        <div>
          <span className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-wider">
            Integraciones Externas
          </span>
          <h3 className="text-sm font-bold text-white font-mono uppercase mt-1">Configuración por WISP</h3>
          <p className="text-[10px] text-slate-500 font-mono mt-1 leading-snug">
            Credenciales reales. CoDi activa al cliente al confirmar transferencia. Facturas por WhatsApp o Telegram según preferencia del abonado.
          </p>
        </div>
        <Key className="w-5 h-5 text-indigo-400 shrink-0" />
      </div>

      {settings && (
        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
          {(['stripe', 'whatsapp', 'telegram', 'codi', 'openpay'] as const).map((key) => (
            <div key={key} className="flex justify-between bg-slate-900/50 border border-slate-900 rounded-lg px-2 py-1.5">
              <span className="text-slate-400 capitalize">{key}</span>
              <span className={statusClass(settings.statuses[key].configured, settings.statuses[key].enabled)}>
                {settings.statuses[key].statusLabel}
              </span>
            </div>
          ))}
          <div className="flex justify-between bg-slate-900/50 border border-slate-900 rounded-lg px-2 py-1.5 col-span-2">
            <span className="text-slate-400 flex items-center gap-1"><Router className="w-3 h-3" /> Mikrotik ROS API</span>
            <span className="text-slate-500">{settings.statuses.mikrotik.statusLabel}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-mono border ${
              active === t.id
                ? 'bg-indigo-900/40 border-indigo-600 text-indigo-200'
                : 'border-slate-800 text-slate-500'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {active === 'stripe' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={stripe.enabled} onChange={(e) => setStripe({ ...stripe, enabled: e.target.checked })} />
            Habilitar Stripe
          </label>
          <input value={stripe.publishableKey} onChange={(e) => setStripe({ ...stripe, publishableKey: e.target.value })} placeholder="Publishable key (pk_live_...)" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={stripe.secretKey} onChange={(e) => setStripe({ ...stripe, secretKey: e.target.value })} placeholder={settings?.stripe.secretKeySet ? 'Secret key (dejar vacío para no cambiar)' : 'Secret key (sk_live_...)'} className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={stripe.webhookSecret} onChange={(e) => setStripe({ ...stripe, webhookSecret: e.target.value })} placeholder="Webhook signing secret" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
        </div>
      )}

      {active === 'whatsapp' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={whatsapp.enabled} onChange={(e) => setWhatsapp({ ...whatsapp, enabled: e.target.checked })} />
            Habilitar WhatsApp Cloud API
          </label>
          <input value={whatsapp.phoneNumberId} onChange={(e) => setWhatsapp({ ...whatsapp, phoneNumberId: e.target.value })} placeholder="Phone Number ID" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input value={whatsapp.businessAccountId} onChange={(e) => setWhatsapp({ ...whatsapp, businessAccountId: e.target.value })} placeholder="Business Account ID (opcional)" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={whatsapp.accessToken} onChange={(e) => setWhatsapp({ ...whatsapp, accessToken: e.target.value })} placeholder={settings?.whatsapp.accessTokenSet ? 'Access token (vacío = sin cambio)' : 'Permanent access token'} className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={whatsapp.webhookVerifyToken} onChange={(e) => setWhatsapp({ ...whatsapp, webhookVerifyToken: e.target.value })} placeholder="Webhook verify token" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <p className="text-[10px] text-slate-500 font-mono">Envía facturas al teléfono del cliente cuando su canal preferido es WhatsApp.</p>
        </div>
      )}

      {active === 'telegram' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={telegram.enabled} onChange={(e) => setTelegram({ ...telegram, enabled: e.target.checked })} />
            Habilitar bot de Telegram
          </label>
          <input value={telegram.botUsername} onChange={(e) => setTelegram({ ...telegram, botUsername: e.target.value })} placeholder="@mi_wisp_bot" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={telegram.botToken} onChange={(e) => setTelegram({ ...telegram, botToken: e.target.value })} placeholder={settings?.telegram.botTokenSet ? 'Bot token (vacío = sin cambio)' : 'Bot token'} className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <p className="text-[10px] text-slate-500 font-mono">Requiere telegram_chat_id en la ficha del cliente (CRM).</p>
        </div>
      )}

      {active === 'codi' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={codi.enabled} onChange={(e) => setCodi({ ...codi, enabled: e.target.checked })} />
            Habilitar CoDi (SPEI / transferencia)
          </label>
          <input value={codi.beneficiaryName} onChange={(e) => setCodi({ ...codi, beneficiaryName: e.target.value })} placeholder="Nombre beneficiario" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input value={codi.clabe} onChange={(e) => setCodi({ ...codi, clabe: e.target.value })} placeholder="CLABE 18 dígitos" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input value={codi.merchantId} onChange={(e) => setCodi({ ...codi, merchantId: e.target.value })} placeholder="ID comercio CoDi (opcional)" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input value={codi.certificateRef} onChange={(e) => setCodi({ ...codi, certificateRef: e.target.value })} placeholder="Referencia certificado (vault)" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={codi.webhookSecret} onChange={(e) => setCodi({ ...codi, webhookSecret: e.target.value })} placeholder="Secreto webhook POST /api/payments/webhook/codi" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <p className="text-[10px] text-slate-500 font-mono">
            Al recibir pago CoDi con referencia de factura, el sistema marca la factura pagada y reactiva al cliente automáticamente.
            Para generar CLABE/referencia SPEI-CoDi automáticas por factura, configure también OpenPay en su pestaña.
          </p>
        </div>
      )}

      {active === 'openpay' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={openpay.enabled} onChange={(e) => setOpenpay({ ...openpay, enabled: e.target.checked })} />
            Habilitar OpenPay (tarjeta + SPEI/CoDi)
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenpay({ ...openpay, sandbox: true })}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-mono border ${
                openpay.sandbox ? 'bg-amber-900/40 border-amber-600 text-amber-200' : 'border-slate-800 text-slate-500'
              }`}
            >
              Sandbox (pruebas)
            </button>
            <button
              type="button"
              onClick={() => setOpenpay({ ...openpay, sandbox: false })}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-mono border ${
                !openpay.sandbox ? 'bg-emerald-900/40 border-emerald-600 text-emerald-200' : 'border-slate-800 text-slate-500'
              }`}
            >
              Producción
            </button>
          </div>
          <input value={openpay.merchantId} onChange={(e) => setOpenpay({ ...openpay, merchantId: e.target.value })} placeholder="Merchant ID (m...)" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input value={openpay.publicKey} onChange={(e) => setOpenpay({ ...openpay, publicKey: e.target.value })} placeholder="Public key (pk_...)" className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={openpay.privateKey} onChange={(e) => setOpenpay({ ...openpay, privateKey: e.target.value })} placeholder={settings?.openpay.privateKeySet ? 'Private key (vacío = sin cambio)' : 'Private key (sk_...)'} className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <input type="password" value={openpay.webhookSecret} onChange={(e) => setOpenpay({ ...openpay, webhookSecret: e.target.value })} placeholder={settings?.openpay.webhookSecretSet ? 'Webhook secret (vacío = sin cambio)' : 'Webhook secret (X-OpenPay-Signature)'} className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white" />
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Webhook className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-300">
                URL de webhook de este WISP
              </h4>
            </div>
            <p className="text-[10px] text-slate-400 font-mono leading-snug">{webhook.hint}</p>
            {webhook.available && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="openpay-webhook-url"
                  readOnly
                  value={webhook.url}
                  aria-label="URL de webhook de OpenPay de este WISP"
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 truncate rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-[11px] font-mono text-slate-300"
                />
                <button
                  id="copy-openpay-webhook"
                  type="button"
                  onClick={() => void copyWebhookUrl()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 shrink-0"
                >
                  {webhookCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {webhookCopied ? 'Copiada' : 'Copiar URL'}
                </button>
              </div>
            )}
            <p role="status" aria-live="polite" className="text-[10px] font-mono text-emerald-400 min-h-[13px]">
              {webhookCopied ? 'URL de webhook copiada al portapapeles.' : ''}
            </p>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            OpenPay procesa tarjeta y SPEI/CoDi: cada factura obtiene CLABE virtual y referencia; el pago se confirma por webhook.
            Use sandbox hasta validar el flujo end-to-end; las llaves se guardan cifradas.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" id="integrations-save" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> Guardar
        </button>
        <button type="button" id={`integrations-test-${active}`} disabled={busy} onClick={() => void test(active)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">
          <Zap className="w-3.5 h-3.5" /> Probar conexión
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-rose-400 font-mono flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </p>
      )}
      {testResult && (
        <p className={`text-[11px] font-mono flex items-center gap-1 ${testResult.startsWith('OK') ? 'text-emerald-400' : 'text-amber-400'}`}>
          {testResult.startsWith('OK') ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {testResult}
        </p>
      )}
    </div>
  );
}
