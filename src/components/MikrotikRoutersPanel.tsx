import React, { useState } from 'react';
import {
  Router as RouterIcon,
  Plus,
  ShieldAlert,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  PlugZap,
  Lock,
  Loader2,
  X,
} from 'lucide-react';
import type {
  MikrotikRouterView,
  MikrotikConnectionType,
  MikrotikProvisioningMode,
  ProvisioningScriptResponse,
  MikrotikTestConnectionResponse,
} from '../types';
import type { UserRole } from '../lib/supabase';
import { canManageRouters, canGenerateScript, canRotateCredentials } from '../lib/mikrotikRbac';
import { connectionTypeLabel, statusBadge, clipboardScript, type StatusTone } from '../lib/mikrotikView';

// Modos de provisioning (Fase 4.6.0). WireGuard = principal; SSTP = fallback;
// Tailscale/Direct = laboratorio.
export const PROVISIONING_MODE_OPTIONS: { value: MikrotikProvisioningMode; label: string; tag: string; help: string }[] = [
  { value: 'wireguard_managed', label: 'WireGuard administrado por NugaCore', tag: 'Recomendado', help: 'Recomendado para RouterOS v7 y operación normal.' },
  { value: 'sstp_managed', label: 'SSTP administrado por NugaCore', tag: 'Fallback', help: 'Fallback para NAT/firewalls difíciles o RouterOS v6.' },
  { value: 'tailscale_lab', label: 'Tailscale / Direct (laboratorio)', tag: 'Laboratorio', help: 'Solo laboratorio o soporte. No recomendado para clientes externos.' },
  { value: 'direct_lab', label: 'Direct (laboratorio)', tag: 'Laboratorio', help: 'Solo laboratorio o soporte. No recomendado para clientes externos.' },
];
const modeHelp = (m: string): string => PROVISIONING_MODE_OPTIONS.find((o) => o.value === m)?.help || '';

interface Props {
  routers: MikrotikRouterView[];
  userRole: UserRole;
  onRefresh: () => Promise<void>;
  onCreateRouter: (payload: Record<string, unknown>) => Promise<void>;
  onGenerateScript: (id: string, connectionType: string, server?: Record<string, unknown>) => Promise<ProvisioningScriptResponse>;
  onRotateCredentials: (id: string, connectionType: string, server?: Record<string, unknown>) => Promise<ProvisioningScriptResponse>;
  onTestConnection: (id: string) => Promise<MikrotikTestConnectionResponse>;
}

const STATUS_CLASS: Record<StatusTone, string> = {
  connected: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  provisioned: 'bg-sky-500/15 text-sky-400 border-sky-500/20',
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  error: 'bg-rose-500/15 text-rose-400 border-rose-500/20',
};

type Toast = { kind: 'success' | 'error'; msg: string } | null;

export default function MikrotikRoutersPanel({
  routers,
  userRole,
  onRefresh,
  onCreateRouter,
  onGenerateScript,
  onRotateCredentials,
  onTestConnection,
}: Props) {
  const canManage = canManageRouters(userRole);
  const canScript = canGenerateScript(userRole);
  const canRotate = canRotateCredentials(userRole);

  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [copied, setCopied] = useState(false);

  // create form
  const [fName, setFName] = useState('');
  const [fIp, setFIp] = useState('');
  const [fType, setFType] = useState<MikrotikProvisioningMode>('wireguard_managed');
  const [fApiPort, setFApiPort] = useState('8728');
  const [fNotes, setFNotes] = useState('');

  // Configuración avanzada del servidor VPN (opcional; se envía como `server`).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adv, setAdv] = useState<Record<string, string>>({});
  const buildServer = (): Record<string, unknown> | undefined => {
    const map: Record<string, string> = {
      vpnServerHost: adv.vpnServerHost, vpnNetworkCidr: adv.vpnNetworkCidr,
      routerVpnIp: adv.routerVpnIp, serverVpnIp: adv.serverVpnIp,
      allowedApiCidr: adv.allowedApiCidr, serverManagementCidr: adv.serverManagementCidr,
    };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map)) if (v && v.trim()) out[k] = v.trim();
    if (adv.vpnServerPort && adv.vpnServerPort.trim()) out.vpnServerPort = Number(adv.vpnServerPort);
    return Object.keys(out).length ? out : undefined;
  };

  // script modal (shown once)
  const [scriptResult, setScriptResult] = useState<ProvisioningScriptResponse | null>(null);
  // test result
  const [testResult, setTestResult] = useState<MikrotikTestConnectionResponse | null>(null);
  // per-router connection type selection for generating script
  const [genType, setGenType] = useState<Record<string, MikrotikProvisioningMode>>({});

  const flash = (kind: 'success' | 'error', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName || !fIp) return;
    setBusy('Creando router...');
    try {
      // El registro guarda el connectionType base; el modo administrado se
      // elige al generar el script.
      const baseType = ({
        wireguard_managed: 'wireguard', sstp_managed: 'sstp', tailscale_lab: 'tailscale', direct_lab: 'direct',
      } as Record<MikrotikProvisioningMode, string>)[fType];
      await onCreateRouter({
        name: fName,
        managementIp: fIp,
        connectionType: baseType,
        apiPort: Number(fApiPort) || 8728,
        notes: fNotes || undefined,
      });
      flash('success', 'Router registrado.');
      setFName(''); setFIp(''); setFNotes('');
      setShowCreate(false);
    } catch (err: any) {
      flash('error', err?.message || 'No se pudo crear el router.');
    } finally {
      setBusy('');
    }
  };

  const handleGenerate = async (id: string) => {
    const type = genType[id] || 'wireguard_managed';
    setBusy('Generando script...');
    try {
      const resp = await onGenerateScript(id, type, buildServer());
      setScriptResult(resp);
      setCopied(false);
      await onRefresh();
    } catch (err: any) {
      flash('error', err?.message || 'No se pudo generar el script.');
    } finally {
      setBusy('');
    }
  };

  const handleRotate = (id: string) => {
    const type = genType[id] || 'wireguard_managed';
    const ok = window.confirm(
      'Rotar credenciales invalida la credencial anterior del router y genera un script nuevo. ¿Continuar?',
    );
    if (!ok) return;
    setBusy('Rotando credenciales...');
    onRotateCredentials(id, type, buildServer())
      .then((resp) => {
        setScriptResult(resp);
        setCopied(false);
        flash('success', 'Credenciales rotadas. Copia el nuevo script.');
        return onRefresh();
      })
      .catch((err: any) => flash('error', err?.message || 'No se pudo rotar.'))
      .finally(() => setBusy(''));
  };

  const handleTest = async (id: string) => {
    setBusy('Probando conexión (dry-run)...');
    try {
      const resp = await onTestConnection(id);
      setTestResult(resp);
    } catch (err: any) {
      flash('error', err?.message || 'No se pudo probar la conexión.');
    } finally {
      setBusy('');
    }
  };

  const copyScript = async () => {
    if (!scriptResult) return;
    const text = clipboardScript(scriptResult);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      flash('error', 'No se pudo copiar. Selecciona y copia manualmente.');
    }
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-3xl p-5 space-y-4">
      {toast && (
        <div
          className={`fixed top-5 right-5 z-[60] flex items-center space-x-2 px-4 py-3 rounded-xl border text-xs font-mono shadow-xl ${
            toast.kind === 'success'
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
          }`}
        >
          <span>{toast.msg}</span>
        </div>
      )}
      {busy && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[60] flex items-center space-x-2 bg-slate-950 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-mono shadow-xl">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>{busy}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-3">
        <div>
          <h3 className="text-sm font-bold text-white font-mono uppercase flex items-center space-x-2">
            <RouterIcon className="w-4 h-4 text-indigo-400" />
            <span>Routers MikroTik</span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Registra routers y genera un script seguro de conexión (WireGuard / SSTP) para pegar en RouterOS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRefresh()}
            className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white transition"
            title="Refrescar"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {canManage ? (
            <button
              id="mkt-add-router-btn"
              onClick={() => setShowCreate(true)}
              className="flex items-center space-x-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl text-xs font-semibold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Registrar Router</span>
            </button>
          ) : (
            <span className="flex items-center space-x-1.5 text-[11px] bg-slate-800/60 text-slate-400 border border-slate-700 px-3 py-1.5 rounded-lg font-mono">
              <Lock className="w-3.5 h-3.5" />
              <span>Solo lectura</span>
            </span>
          )}
        </div>
      </div>

      {/* Configuración avanzada del servidor VPN (opcional, aplica al generar) */}
      {canScript && (
        <div className="border border-slate-900 rounded-2xl">
          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono text-slate-400 hover:text-slate-200"
          >
            <span>Configuración del servidor VPN (avanzado · opcional)</span>
            <span>{showAdvanced ? '−' : '+'}</span>
          </button>
          {showAdvanced && (
            <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
              {[
                ['vpnServerHost', 'Server host (WG/SSTP)'],
                ['vpnServerPort', 'Server port'],
                ['vpnNetworkCidr', 'VPN CIDR'],
                ['routerVpnIp', 'Router tunnel IP (/32)'],
                ['serverVpnIp', 'Server tunnel IP'],
                ['allowedApiCidr', 'Allowed API CIDR'],
                ['serverManagementCidr', 'Management CIDR'],
              ].map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <label className="text-slate-500 font-mono">{label}</label>
                  <input
                    value={adv[key] || ''}
                    onChange={(e) => setAdv((m) => ({ ...m, [key]: e.target.value }))}
                    className="w-full bg-slate-900 text-white border border-slate-800 rounded-lg p-1.5 font-mono"
                  />
                </div>
              ))}
              <p className="col-span-2 md:col-span-3 text-[10px] text-slate-600 font-mono">
                Vacío usa los valores del servidor NugaCore (env). WireGuard usa server host/port, VPN CIDR, router/server tunnel IP, allowed API CIDR. SSTP usa server host/port, router tunnel IP, management CIDR. Lab usa allowed API CIDR.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Router list */}
      <div className="space-y-2.5">
        {routers.length === 0 ? (
          <div className="text-center py-10 text-slate-500 font-mono text-sm">
            <RouterIcon className="w-10 h-10 text-slate-800 mx-auto mb-3" />
            Sin routers registrados.
          </div>
        ) : (
          routers.map((r) => {
            const badge = statusBadge(r.status);
            const selType = genType[r.id] || 'wireguard_managed';
            return (
              <div key={r.id} id={`mkt-router-${r.id}`} className="bg-slate-900/40 border border-slate-900 rounded-2xl p-3.5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-sm">{r.name}</span>
                      <span className="bg-slate-850 text-slate-400 border border-slate-800 font-mono text-[9px] px-1.5 py-0.2 rounded uppercase">{r.id}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-1">
                      {r.managementIp || r.ipAddress} · API {r.apiPort} · {connectionTypeLabel(r.connectionType)} · RouterOS {r.routerOsVersion}
                    </div>
                    <div className="text-[10px] text-slate-600 font-mono mt-0.5">
                      user: {r.username} · {r.hasCredentials ? 'credenciales presentes' : 'sin credenciales'}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${STATUS_CLASS[badge.tone]}`}>
                    {badge.label}
                  </span>
                </div>

                {(canScript || canRotate) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-900 pt-2.5">
                    {canScript && (
                      <select
                        value={selType}
                        onChange={(e) => setGenType((m) => ({ ...m, [r.id]: e.target.value as MikrotikProvisioningMode }))}
                        className="bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none max-w-[260px]"
                      >
                        {PROVISIONING_MODE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label} — {o.tag}</option>
                        ))}
                      </select>
                    )}
                    {canScript && (
                      <button
                        onClick={() => handleGenerate(r.id)}
                        className="flex items-center space-x-1 bg-indigo-600/20 hover:bg-indigo-600 hover:text-white text-indigo-300 border border-indigo-500/30 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        <span>Generar Script</span>
                      </button>
                    )}
                    {canScript && (
                      <button
                        onClick={() => handleTest(r.id)}
                        className="flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition"
                      >
                        <PlugZap className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Probar (dry-run)</span>
                      </button>
                    )}
                    {canRotate && (
                      <button
                        onClick={() => handleRotate(r.id)}
                        className="flex items-center space-x-1 bg-slate-800 hover:bg-amber-600/30 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                        <span>Rotar credenciales</span>
                      </button>
                    )}
                    {canScript && (
                      <p className="w-full text-[10px] text-slate-500 font-mono">{modeHelp(selType)}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create modal */}
      {showCreate && canManage && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <RouterIcon className="w-4 h-4 text-indigo-400" />
                <span>Registrar Router MikroTik</span>
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Nombre</label>
                <input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Router Core Norte" className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5" />
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 font-mono">IP de administración</label>
                <input required value={fIp} onChange={(e) => setFIp(e.target.value)} placeholder="10.0.1.1" className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Modo de conexión</label>
                  <select value={fType} onChange={(e) => setFType(e.target.value as MikrotikProvisioningMode)} className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5">
                    {PROVISIONING_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label} — {o.tag}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500 font-mono">{modeHelp(fType)}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400 font-mono">Puerto API</label>
                  <input value={fApiPort} onChange={(e) => setFApiPort(e.target.value)} className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5 font-mono" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-slate-400 font-mono">Notas (opcional)</label>
                <input value={fNotes} onChange={(e) => setFNotes(e.target.value)} className="w-full bg-slate-900 text-white border border-slate-800 rounded-xl p-2.5" />
              </div>
              <div className="border-t border-slate-900 pt-3 flex justify-end space-x-2">
                <button type="button" onClick={() => setShowCreate(false)} className="border border-slate-800 hover:bg-slate-900 text-slate-400 px-4 py-2 rounded-xl">Cancelar</button>
                <button type="submit" disabled={!!busy} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white px-5 py-2 rounded-xl font-semibold">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Script modal (shown ONCE) */}
      {scriptResult && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                <span>Script de Provisioning ({scriptResult.connectionType.toUpperCase()})</span>
              </h3>
              <button id="mkt-script-close" onClick={() => setScriptResult(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            <div className="bg-rose-950/40 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-[11px] text-rose-200">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{scriptResult.securityWarning}</span>
            </div>

            {scriptResult.warnings.length > 0 && (
              <div className="bg-amber-950/30 border border-amber-500/20 rounded-xl p-3 text-[11px] text-amber-300 space-y-1">
                {scriptResult.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div className="text-[11px] font-mono text-slate-400 space-y-1">
              <div>Usuario API: <span className="text-slate-200">{scriptResult.credentials.apiUsername}</span></div>
              <div>Token de provisioning (un solo uso): <span className="text-indigo-300 break-all">{scriptResult.provisioningToken}</span></div>
              <div>Expira: {scriptResult.tokenExpiresAt}</div>
              <div>Hash del script: {scriptResult.scriptHash.substring(0, 16)}…</div>
            </div>

            <div className="relative">
              <button
                id="mkt-copy-script"
                onClick={copyScript}
                className="absolute right-2 top-2 flex items-center space-x-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-2.5 py-1.5 rounded-lg text-[11px] font-bold z-10"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
              <pre className="bg-black border border-slate-800 rounded-xl p-4 pt-12 text-[10px] text-emerald-400 font-mono overflow-x-auto max-h-[40vh] whitespace-pre-wrap">{scriptResult.script}</pre>
            </div>

            <div className="flex justify-end">
              <button onClick={() => setScriptResult(null)} className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-semibold">
                Ya lo guardé, cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test connection modal */}
      {testResult && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-3xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <PlugZap className="w-4 h-4 text-emerald-400" />
                <span>Prueba de Conexión (dry-run)</span>
              </h3>
              <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className={`text-xs font-mono font-bold ${testResult.reachable ? 'text-emerald-400' : 'text-amber-400'}`}>
              {testResult.reachable ? 'DRY-RUN OK' : 'DRY-RUN INCOMPLETO'} · modo {testResult.mode}
            </div>
            <div className="space-y-1.5">
              {testResult.checks.map((c) => (
                <div key={c.name} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">{c.name}</span>
                  <span className={c.ok ? 'text-emerald-400' : 'text-rose-400'}>{c.ok ? 'OK' : 'FALTA'}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{testResult.message}</p>
            <div className="flex justify-end">
              <button onClick={() => setTestResult(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs">Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
