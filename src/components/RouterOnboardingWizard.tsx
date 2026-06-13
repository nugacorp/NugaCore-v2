// ====================================================================
// Router Onboarding Wizard (Fase 4.9)
//
// Experiencia unificada para agregar un router a NugaCore desde el
// módulo MikroTik. Oculta completamente WireGuard peers, servidores
// y conceptos internos del enrollment.
//
// El usuario ve: nombre → tipo → plantilla → LAN → generar → descargar → online.
// El wizard llama internamente: POST /api/router-enrollment/start
//                               GET  /api/router-enrollment/:id/download
//                               POST /api/router-enrollment/:id/check-online
// ====================================================================

import React, { useState } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Server,
  Wifi,
  FileCode,
  Network,
  Zap,
  Download,
  CheckCircle,
  AlertTriangle,
  Clock,
  Loader2,
  Shield,
  Copy,
  RouterIcon,
} from 'lucide-react';
import type { UserRole } from '../lib/supabase';
import {
  DEFAULT_FORM,
  ONBOARDING_TEMPLATES,
  ROUTER_TYPE_OPTIONS,
  MODEL_OPTIONS,
  OnboardingForm,
  buildEnrollmentPayload,
  getTemplateV7Warning,
} from '../lib/routerOnboardingView';

// ── Tipos locales ──────────────────────────────────────────────────────

interface StartResult {
  enrollmentId: string;
  peerId: string;
  assignedIp: string;
  filename: string;
  scriptPreview: string;
  securityNotice: string;
  enrollment: { id: string; status: string; statusLabel: string };
  script: string;
  scriptFilename: string;
  scriptHash: string;
  securityWarning: string;
  wgAssignedIp: string;
}

interface CheckResult {
  isOnline: boolean;
  message: string;
  snapshotSource: 'live' | 'simulated' | null;
  enrollment: { status: string; failureReason?: string };
}

// ── Props ──────────────────────────────────────────────────────────────

export interface RouterOnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCompleted: () => void;
  userRole: UserRole | string | null;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

// ── Constantes ─────────────────────────────────────────────────────────

const STEP_LABELS = [
  'Datos',
  'Conectividad',
  'Plantilla',
  'LAN',
  'Generar',
  'Descargar',
  'Confirmar',
];

const TOTAL_STEPS = STEP_LABELS.length;

// ── Componente ─────────────────────────────────────────────────────────

export default function RouterOnboardingWizard({
  isOpen,
  onClose,
  onCompleted,
  getAuthHeaders,
}: RouterOnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingForm>({ ...DEFAULT_FORM });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wgDefaultOk, setWgDefaultOk] = useState<boolean | null>(null);
  const [startResult, setStartResult] = useState<StartResult | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const setF = (patch: Partial<OnboardingForm>) => setForm((f) => ({ ...f, ...patch }));
  const clearError = () => setError('');

  // ── Acciones ───────────────────────────────────────────────────────

  const checkWgDefault = async () => {
    setLoading(true);
    clearError();
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/wireguard/servers', { headers });
      if (res.ok) {
        const servers: Array<{ isDefault?: boolean; status: string }> = await res.json();
        const hasDefault = servers.some(
          (s) => (s.isDefault === true || s.isDefault === undefined) && s.status === 'active',
        );
        setWgDefaultOk(hasDefault || servers.length > 0);
      } else {
        setWgDefaultOk(false);
      }
    } catch {
      setWgDefaultOk(false);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    clearError();
    try {
      const payload = buildEnrollmentPayload(form);
      const headers = await getAuthHeaders();
      const res = await fetch('/api/router-enrollment/start', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar configuración.');
      setStartResult(data as StartResult);
      setStep(6);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!startResult) return;
    try {
      const headers = await getAuthHeaders();
      const enrollmentId = startResult.enrollmentId || startResult.enrollment.id;
      const res = await fetch(`/api/router-enrollment/${enrollmentId}/download`, { headers });
      if (!res.ok) throw new Error('Error al descargar el script.');
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = startResult.scriptFilename || startResult.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al descargar.');
    }
  };

  const handleCheckOnline = async () => {
    if (!startResult) return;
    setLoading(true);
    clearError();
    try {
      const headers = await getAuthHeaders();
      const enrollmentId = startResult.enrollmentId || startResult.enrollment.id;
      const res = await fetch(`/api/router-enrollment/${enrollmentId}/check-online`, {
        method: 'POST',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al verificar conexión.');
      setCheckResult(data as CheckResult);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al verificar.');
    } finally {
      setLoading(false);
    }
  };

  const copyPreview = () => {
    if (!startResult) return;
    navigator.clipboard.writeText(startResult.scriptPreview || startResult.script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClose = () => {
    setStep(1);
    setForm({ ...DEFAULT_FORM });
    setStartResult(null);
    setCheckResult(null);
    clearError();
    setWgDefaultOk(null);
    onClose();
  };

  const handleFinish = () => {
    handleClose();
    onCompleted();
  };

  // ── Render helpers ─────────────────────────────────────────────────

  const stepTo = (n: number) => { clearError(); setStep(n); };

  const v7Warning = getTemplateV7Warning(form.templateId, form.routerosVersion);

  const fileName = startResult?.scriptFilename || startResult?.filename || '';
  const assignedIp = startResult?.wgAssignedIp || startResult?.assignedIp || '';

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
              <Server size={18} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Agregar Router</h2>
              <p className="text-xs text-slate-400">
                Paso {step} de {TOTAL_STEPS}: {STEP_LABELS[step - 1]}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Barra de progreso */}
        <div className="flex items-center gap-0.5 px-6 py-3 border-b border-slate-700/30">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={i}>
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors
                  ${i + 1 < step  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : ''}
                  ${i + 1 === step ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30' : ''}
                  ${i + 1 > step  ? 'text-slate-600 border border-transparent' : ''}
                `}
              >
                {i + 1 < step && <CheckCircle size={9} />}
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </div>
              {i < TOTAL_STEPS - 1 && (
                <ChevronRight size={10} className="text-slate-700 shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="p-6 space-y-5">
          {/* Error global */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Paso 1: Datos del router ──────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Server size={16} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Datos del router</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Nombre del router <span className="text-rose-400">*</span>
                  </label>
                  <input
                    value={form.routerName}
                    onChange={(e) => setF({ routerName: e.target.value })}
                    placeholder="Torre Norte — RB5009"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Tipo de router <span className="text-rose-400">*</span></label>
                  <select
                    value={form.routerType}
                    onChange={(e) => setF({ routerType: e.target.value as OnboardingForm['routerType'] })}
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                  >
                    {ROUTER_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Versión RouterOS <span className="text-rose-400">*</span></label>
                  <select
                    value={form.routerosVersion}
                    onChange={(e) => setF({ routerosVersion: e.target.value as '6' | '7' })}
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                  >
                    <option value="7">RouterOS v7 (recomendado)</option>
                    <option value="6">RouterOS v6</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Modelo</label>
                  <select
                    value={form.model}
                    onChange={(e) => setF({ model: e.target.value as OnboardingForm['model'] })}
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
                  >
                    {MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Sitio / Ubicación</label>
                  <input
                    value={form.siteName}
                    onChange={(e) => setF({ siteName: e.target.value })}
                    placeholder="Torre del Valle"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Notas</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setF({ notes: e.target.value })}
                    placeholder="Reemplaza router viejo, sector norte"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    if (!form.routerName.trim()) { setError('El nombre del router es obligatorio.'); return; }
                    stepTo(2);
                    checkWgDefault();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 2: Conectividad ──────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wifi size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Conectividad NugaCore</h3>
              </div>

              {/* Siempre muestra el bloque de VPN gestionada */}
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle size={15} />
                  Administrado por NugaCore VPN
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  NugaCore asignará automáticamente una IP VPN única al router, creará el peer WireGuard
                  y generará el script de configuración. No necesitas configurar nada manualmente.
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1">
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> Peer WireGuard automático</span>
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> IP VPN asignada automáticamente</span>
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> Claves nunca visibles en UI</span>
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> Script .rsc generado en segundos</span>
                </div>
              </div>

              {/* Estado del servidor WG default */}
              {loading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                  <Loader2 size={12} className="animate-spin" /> Verificando servidor VPN…
                </div>
              )}

              {!loading && wgDefaultOk === false && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
                  <AlertTriangle size={14} className="inline mr-1.5" />
                  No existe un servidor WireGuard principal activo. Un administrador debe crearlo
                  en el módulo <strong>WireGuard Manager</strong> antes de agregar routers.
                </div>
              )}

              {!loading && wgDefaultOk === true && (
                <div className="flex items-center gap-2 text-emerald-400 text-xs">
                  <CheckCircle size={12} /> Servidor VPN disponible y activo.
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => stepTo(1)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={() => stepTo(3)}
                  disabled={wgDefaultOk === false}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 3: Plantilla inicial ─────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <FileCode size={16} className="text-purple-400" />
                <h3 className="text-sm font-semibold text-white">Plantilla inicial</h3>
              </div>

              {v7Warning && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  {v7Warning}
                </div>
              )}

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {ONBOARDING_TEMPLATES.map((tpl) => {
                  const incompatible = tpl.routerosVersion === '7' && form.routerosVersion === '6';
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => setF({ templateId: tpl.id })}
                      className={`w-full text-left p-3 rounded-xl border transition-colors ${
                        form.templateId === tpl.id
                          ? 'border-purple-500/50 bg-purple-500/5'
                          : 'border-slate-700/50 bg-slate-800/50 hover:border-slate-600/50'
                      } ${incompatible ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`text-sm font-medium ${form.templateId === tpl.id ? 'text-purple-300' : 'text-slate-200'}`}>
                          {tpl.label}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          tpl.routerosVersion === '7'
                            ? 'text-blue-400 border-blue-500/20 bg-blue-500/10'
                            : 'text-slate-500 border-slate-600/30 bg-slate-700/30'
                        }`}>
                          {tpl.routerosVersion === '7' ? 'v7 only' : 'v6/v7'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{tpl.description}</p>
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-between">
                <button onClick={() => stepTo(2)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={() => stepTo(4)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 4: Configuración LAN ─────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Network size={16} className="text-orange-400" />
                <h3 className="text-sm font-semibold text-white">
                  Configuración LAN <span className="text-slate-500 font-normal text-xs">(con valores por defecto)</span>
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">CIDR LAN</label>
                  <input
                    value={form.lanCidr}
                    onChange={(e) => setF({ lanCidr: e.target.value })}
                    placeholder="192.168.88.0/24"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Gateway LAN</label>
                  <input
                    value={form.lanGateway}
                    onChange={(e) => setF({ lanGateway: e.target.value })}
                    placeholder="192.168.88.1"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Nombre bridge LAN</label>
                  <input
                    value={form.lanBridgeName}
                    onChange={(e) => setF({ lanBridgeName: e.target.value })}
                    placeholder="bridgeLAN"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Interfaz WAN</label>
                  <input
                    value={form.wanInterface}
                    onChange={(e) => setF({ wanInterface: e.target.value })}
                    placeholder="ether1"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">DHCP inicio</label>
                  <input
                    value={form.dhcpStart}
                    onChange={(e) => setF({ dhcpStart: e.target.value })}
                    placeholder="192.168.88.10"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">DHCP fin</label>
                  <input
                    value={form.dhcpEnd}
                    onChange={(e) => setF({ dhcpEnd: e.target.value })}
                    placeholder="192.168.88.254"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Interfaces LAN (separadas por coma)</label>
                  <input
                    value={form.lanInterfaces}
                    onChange={(e) => setF({ lanInterfaces: e.target.value })}
                    placeholder="ether2,ether3,ether4,ether5"
                    className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => stepTo(3)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={() => stepTo(5)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 5: Generar configuración ─────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Generar configuración</h3>
              </div>

              {/* Resumen */}
              <div className="p-4 bg-slate-800/60 border border-slate-700/50 rounded-xl space-y-2 text-sm">
                {[
                  ['Router', form.routerName],
                  ['Tipo', ROUTER_TYPE_OPTIONS.find((o) => o.value === form.routerType)?.label],
                  ['Modelo', form.model],
                  ['RouterOS', `v${form.routerosVersion}`],
                  ['Plantilla', ONBOARDING_TEMPLATES.find((t) => t.id === form.templateId)?.label],
                  ['LAN', form.lanCidr || '(default)'],
                  ['Gateway', form.lanGateway || '(default)'],
                  ['WAN', form.wanInterface || '(default)'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-slate-500">{label}</span>
                    <span className="text-slate-200 font-medium">{value}</span>
                  </div>
                ))}
              </div>

              {/* Advertencia de seguridad */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                El script .rsc contiene la clave privada WireGuard del router.
                Guárdalo de forma segura y elimínalo del equipo tras importarlo.
              </div>

              <div className="flex justify-between">
                <button onClick={() => stepTo(4)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
                  {loading ? 'Generando…' : 'Generar configuración'}
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 6: Descargar .rsc ────────────────────────────────── */}
          {step === 6 && startResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Download size={16} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Descargar configuración</h3>
              </div>

              {/* Resultado del enrollment */}
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2">
                <CheckCircle size={14} />
                Configuración generada. IP VPN asignada: <strong className="font-mono">{assignedIp}</strong>
              </div>

              {/* Security notice */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {startResult.securityWarning || startResult.securityNotice}
              </div>

              {/* Vista previa sanitizada */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-mono">{fileName}</span>
                  <button onClick={copyPreview} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                    {copied ? <CheckCircle size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {copied ? 'Copiado' : 'Copiar preview'}
                  </button>
                </div>
                <pre className="bg-slate-950 border border-slate-700/50 rounded-lg p-3 text-[11px] text-emerald-300 font-mono overflow-auto max-h-32 whitespace-pre-wrap leading-relaxed">
                  {startResult.scriptPreview}
                </pre>
                <p className="text-[10px] text-slate-600 font-mono">hash: {startResult.scriptHash}</p>
              </div>

              {/* Instrucciones */}
              <div className="space-y-2.5">
                <p className="text-xs font-medium text-slate-300">Cómo importar en el MikroTik:</p>
                {[
                  ['Abre WinBox o SSH y conéctate al router.', null],
                  ['Haz un backup (recomendado):', '/system backup save name=pre-nugacore'],
                  ['Sube el archivo .rsc a Files (drag & drop en WinBox).', null],
                  ['En Terminal, importa el script:', `/import file-name=${fileName}`],
                  ['Elimina el archivo tras importarlo:', '/file remove [find name~"nugacore-tpl-"]'],
                ].map(([text, code], i) => (
                  <div key={i} className="flex gap-2.5">
                    <span className="shrink-0 w-5 h-5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 rounded-full flex items-center justify-center text-[10px] font-bold">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-xs text-slate-300">{text}</p>
                      {code && (
                        <pre className="mt-1 bg-slate-950 px-2 py-1 rounded text-[10px] font-mono text-emerald-300">{code}</pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div />
                <div className="flex gap-2">
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download size={14} /> Descargar .rsc
                  </button>
                  <button
                    onClick={() => stepTo(7)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition-colors"
                  >
                    Ya importé el script <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Paso 7: Confirmar online ──────────────────────────────── */}
          {step === 7 && startResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wifi size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Confirmar router online</h3>
              </div>

              <p className="text-sm text-slate-400">
                NugaCore intentará conectarse al router via WireGuard en modo lectura (dry_run).
                Este paso puede tomar unos segundos.
              </p>

              {/* Estado actual */}
              {!checkResult && (
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-400 text-sm flex items-center gap-2">
                  <Clock size={14} />
                  Pendiente de importar el script en el MikroTik.
                </div>
              )}

              {checkResult && (
                <div className={`p-3 rounded-lg border text-sm flex items-start gap-2 ${
                  checkResult.isOnline
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                }`}>
                  {checkResult.isOnline
                    ? <CheckCircle size={14} className="shrink-0 mt-0.5" />
                    : <Clock size={14} className="shrink-0 mt-0.5" />
                  }
                  <div>
                    <p>{checkResult.message}</p>
                    {checkResult.snapshotSource && (
                      <p className="text-xs opacity-70 mt-0.5">fuente: {checkResult.snapshotSource}</p>
                    )}
                  </div>
                </div>
              )}

              {checkResult?.enrollment.status === 'failed' && checkResult.enrollment.failureReason && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">
                  <AlertTriangle size={14} className="inline mr-1.5" />
                  {checkResult.enrollment.failureReason}
                </div>
              )}

              {!checkResult?.isOnline && (
                <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-lg text-xs text-slate-500 space-y-1">
                  <p className="font-medium text-slate-400">Si el router aún no aparece online:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Verifica que el script fue importado correctamente.</li>
                    <li>Confirma que el MikroTik tiene acceso a internet.</li>
                    <li>Espera 30–60 segundos y vuelve a verificar.</li>
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between">
                <button onClick={() => stepTo(6)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <div className="flex gap-2">
                  {checkResult?.isOnline ? (
                    <button
                      onClick={handleFinish}
                      className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      <CheckCircle size={15} />
                      Router conectado — Finalizar
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleFinish}
                        className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
                      >
                        Finalizar sin verificar
                      </button>
                      <button
                        onClick={handleCheckOnline}
                        disabled={loading || checkResult?.enrollment.status === 'failed'}
                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                      >
                        {loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                        {loading ? 'Verificando…' : 'Verificar conexión'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
