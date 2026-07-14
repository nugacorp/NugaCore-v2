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
import { createAuthorizedApi } from '../lib/apiClient';
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
  SlidersHorizontal,
} from 'lucide-react';
import type { UserRole } from '../lib/supabase';
import {
  ONBOARDING_TEMPLATES,
  ONBOARDING_SIMPLE_TEMPLATES,
  FACTORY_RESET_CHECKLIST,
  isWireguardManagedTemplate,
  ROUTER_TYPE_OPTIONS,
  MODEL_OPTIONS,
  DEFAULT_ADVANCED_FORM,
  AdvancedOnboardingForm,
  buildAdvancedEnrollmentPayload,
  getTemplateV7Warning,
  getTemplateLabel,
  setTemplateSelection,
  } from '../lib/routerOnboardingView';
import {
  TemplateParameterSchema,
  TemplateParameterGroup,
  TemplateParameter,
  TemplateParameterValues,
  buildDefaultParameterValues,
  getParamValue,
  setParamValue,
  groupValuesOf,
  isParameterVisible,
  countConfiguredParameters,
  syncDhcpPoolsWithLanCidr,
} from '../lib/templateParametersView';

/** Clona el formulario por defecto con objetos anidados frescos (evita refs compartidas). */
const freshDefaultForm = (): AdvancedOnboardingForm => ({
  ...DEFAULT_ADVANCED_FORM,
  wanConfigs: DEFAULT_ADVANCED_FORM.wanConfigs.map((w) => ({ ...w })),
  lanAdvanced: { ...DEFAULT_ADVANCED_FORM.lanAdvanced },
  security: { ...DEFAULT_ADVANCED_FORM.security },
});

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
  snmpCommunity?: string;
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
  'Preparación',
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
  const [form, setForm] = useState<AdvancedOnboardingForm>(freshDefaultForm);
  // Fase 4.9.2: esquema y valores del formulario dinámico de parámetros.
  const [paramSchema, setParamSchema] = useState<TemplateParameterSchema | null>(null);
  const [paramValues, setParamValues] = useState<TemplateParameterValues>({});
  const [paramsLoading, setParamsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [wgDefaultOk, setWgDefaultOk] = useState<boolean | null>(null);
  const [startResult, setStartResult] = useState<StartResult | null>(null);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [factoryChecks, setFactoryChecks] = useState<boolean[]>(
    () => FACTORY_RESET_CHECKLIST.map(() => false),
  );

  if (!isOpen) return null;

  const setF = (patch: Partial<AdvancedOnboardingForm>) => setForm((f) => ({ ...f, ...patch }));
  const clearError = () => setError('');

  // ── Parámetros dinámicos (Fase 4.9.2) ───────────────────────────────

  /** Carga el esquema de parámetros de la plantilla seleccionada e inicializa valores. */
  const loadParameters = async (templateId: string) => {
    setParamsLoading(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      // Si la plantilla no declara parámetros el backend responde error:
      // se trata como formulario dinámico vacío (catch de abajo).
      const schema = await api.get<TemplateParameterSchema>(
        `/api/router-templates/${templateId}/parameters`,
      );
      const defaults = buildDefaultParameterValues(schema);
      if (templateId === 'nugacore_factory_onboarding') {
        if (form.siteName.trim()) defaults.zoneName = form.siteName.trim();
        defaults.lanBridgeName = form.lanBridgeName || defaults.lanBridgeName;
        defaults.wanInterface = form.wanInterface || defaults.wanInterface;
        defaults.lanCidr = form.lanCidr || defaults.lanCidr;
        if (form.lanInterfaces) defaults.lanInterfaces = form.lanInterfaces;
      }
      // Realinear pool DHCP al lanCidr efectivo (defaults del esquema o del form).
      const lanForPool = String(defaults.lanCidr || '');
      setParamValues(syncDhcpPoolsWithLanCidr(schema, defaults, lanForPool));
      setParamSchema(schema);
    } catch {
      setParamSchema(null);
      setParamValues({});
    } finally {
      setParamsLoading(false);
    }
  };

  const setParam = (group: TemplateParameterGroup, param: TemplateParameter, value: unknown) =>
    setParamValues((v) => {
      let next = setParamValue(v, group, param.id, value);
      if (param.id === 'lanCidr' && typeof value === 'string') {
        next = syncDhcpPoolsWithLanCidr(paramSchema, next, value);
      }
      return next;
    });

  /** Renderiza un campo del formulario dinámico según el tipo del parámetro. */
  const renderField = (group: TemplateParameterGroup, param: TemplateParameter) => {
    const gv = groupValuesOf(paramValues, group);
    if (!isParameterVisible(group, param, gv)) return null;
    const value = getParamValue(paramValues, group, param.id);
    const testId = `param-${group.id}-${param.id}`;
    const reqMark = param.required ? <span className="text-rose-400"> *</span> : null;

    if (param.type === 'boolean') {
      return (
        <div key={param.id} className="col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            id={testId}
            data-testid={testId}
            checked={Boolean(value)}
            onChange={(e) => setParam(group, param, e.target.checked)}
            className="w-3.5 h-3.5 accent-indigo-500"
          />
          <label htmlFor={testId} className="text-xs text-slate-300 cursor-pointer">{param.label}</label>
        </div>
      );
    }

    if (param.type === 'select') {
      return (
        <div key={param.id}>
          <label className="block text-[10px] font-medium text-slate-400 mb-1">{param.label}{reqMark}</label>
          <select
            data-testid={testId}
            value={String(value ?? '')}
            onChange={(e) => setParam(group, param, e.target.value)}
            className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500/40"
          >
            {param.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    }

    // string | number | ip | cidr
    return (
      <div key={param.id} className={param.id === 'dnsServers' ? 'col-span-2' : ''}>
        <label className="block text-[10px] font-medium text-slate-400 mb-1">{param.label}{reqMark}</label>
        <input
          data-testid={testId}
          type={param.secret ? 'password' : param.type === 'number' ? 'number' : 'text'}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) =>
            setParam(
              group,
              param,
              param.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
            )
          }
          placeholder={param.defaultValue !== undefined ? String(param.defaultValue) : ''}
          className="w-full bg-slate-800 border border-slate-600/50 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-orange-500/40 font-mono"
        />
        {param.description && <p className="text-[10px] text-slate-600 mt-0.5">{param.description}</p>}
      </div>
    );
  };

  // ── Acciones ───────────────────────────────────────────────────────

  const checkWgDefault = async () => {
    setLoading(true);
    clearError();
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const servers = await api.get<Array<{ isDefault?: boolean; status: string }>>(
        '/api/wireguard/servers',
      );
      const hasDefault = servers.some(
        (s) => (s.isDefault === true || s.isDefault === undefined) && s.status === 'active',
      );
      setWgDefaultOk(hasDefault || servers.length > 0);
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
      // Fase 4.9.2: adjunta los parámetros dinámicos al payload.
      const payload = { ...buildAdvancedEnrollmentPayload(form), templateParameters: paramValues };
      const api = createAuthorizedApi(getAuthHeaders);
      const data = await api.post<StartResult>('/api/router-enrollment/start', payload);
      setStartResult(data);
      setStep(7);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!startResult) return;
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const enrollmentId = startResult.enrollmentId || startResult.enrollment.id;
      // El endpoint devuelve text/plain: apiClient entrega el cuerpo como string.
      const text = await api.get<string>(`/api/router-enrollment/${enrollmentId}/download`);
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
      const api = createAuthorizedApi(getAuthHeaders);
      const enrollmentId = startResult.enrollmentId || startResult.enrollment.id;
      const data = await api.post<CheckResult>(
        `/api/router-enrollment/${enrollmentId}/check-online`,
      );
      setCheckResult(data);
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

  const copyFullScript = () => {
    if (!startResult?.script) return;
    navigator.clipboard.writeText(startResult.script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClose = () => {
    setStep(1);
    setForm(freshDefaultForm());
    setParamSchema(null);
    setParamValues({});
    setStartResult(null);
    setCheckResult(null);
    clearError();
    setWgDefaultOk(null);
    setFactoryChecks(FACTORY_RESET_CHECKLIST.map(() => false));
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
  const factoryReady = factoryChecks.every(Boolean);
  const visibleTemplates = form.configMode === 'advanced'
    ? ONBOARDING_TEMPLATES
    : ONBOARDING_SIMPLE_TEMPLATES;

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

          {/* ── Paso 1: Preparación factory-reset ─────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Preparación del router</h3>
              </div>
              <p className="text-sm text-slate-400">
                Confirma que el router está listo para el onboarding post-factory-reset.
                El script se generará en modo <span className="font-mono text-emerald-300">factory_reset</span>
                (asume router limpio; no uses este flujo en un equipo en producción).
              </p>
              <div className="space-y-2">
                {FACTORY_RESET_CHECKLIST.map((label, index) => (
                  <label key={label} className="flex items-start gap-2 p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={factoryChecks[index]}
                      onChange={(e) => setFactoryChecks((prev) => {
                        const next = [...prev];
                        next[index] = e.target.checked;
                        return next;
                      })}
                      className="mt-0.5 w-3.5 h-3.5 accent-indigo-500"
                    />
                    <span className="text-xs text-slate-300">{label}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    if (!factoryReady) {
                      setError('Marca todos los requisitos antes de continuar.');
                      return;
                    }
                    stepTo(2);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 2: Datos del router ──────────────────────────────── */}
          {step === 2 && (
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
                    onChange={(e) => setF({ routerType: e.target.value as AdvancedOnboardingForm['routerType'] })}
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
                    onChange={(e) => setF({ model: e.target.value as AdvancedOnboardingForm['model'] })}
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
                    stepTo(3);
                    checkWgDefault();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 3: Conectividad ──────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Wifi size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">Conectividad NugaCore</h3>
              </div>

              {/* Siempre muestra el bloque de VPN gestionada */}
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <CheckCircle size={15} />
                  WireGuard en el VPS — peer automático
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  El servidor WireGuard corre en el VPS (interfaz <code className="font-mono text-slate-300">wg0</code>).
                  Por cada script generado, NugaCore crea <strong className="text-slate-300">un peer único</strong> con IP VPN
                  y claves — no se configura manualmente ni se edita desde esta pantalla.
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 pt-1">
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> Servidor WG: VPS (default)</span>
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> Peer: auto al generar</span>
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> IP VPN asignada automáticamente</span>
                  <span className="flex items-center gap-1"><Shield size={10} className="text-indigo-400" /> Claves nunca editables en UI</span>
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
                <button onClick={() => stepTo(2)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={() => stepTo(4)}
                  disabled={wgDefaultOk === false}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 4: Plantilla inicial ─────────────────────────────── */}
          {step === 4 && (
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
                {visibleTemplates.map((tpl) => {
                  const incompatible = tpl.routerosVersion === '7' && form.routerosVersion === '6';
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      data-testid={`template-card-${tpl.id}`}
                      aria-pressed={form.templateId === tpl.id}
                      onClick={() => setForm((f) => setTemplateSelection(f, tpl.id))}
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
                <button onClick={() => stepTo(3)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={() => {
                    // Carga el esquema de parámetros dinámicos de la plantilla.
                    loadParameters(form.templateId);
                    stepTo(5);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 5: Configuración dinámica según plantilla ────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-orange-400" />
                <h3 className="text-sm font-semibold text-white">
                  Configuración de {getTemplateLabel(form.templateId)}
                </h3>
              </div>

              {paramsLoading && (
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                  <Loader2 size={12} className="animate-spin" /> Cargando parámetros…
                </div>
              )}

              {!paramsLoading && !paramSchema && (
                <div className="p-3 bg-slate-800/60 border border-slate-700/50 rounded-lg text-slate-400 text-sm">
                  Esta plantilla no requiere parámetros adicionales. NugaCore usará una
                  configuración segura por defecto.
                </div>
              )}

              {!paramsLoading && paramSchema && (
                <div className="space-y-5 max-h-[52vh] overflow-y-auto pr-1" data-testid="dynamic-params-form">
                  {isWireguardManagedTemplate(form.templateId) && (
                    <div
                      data-testid="wireguard-auto-notice"
                      className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-xs text-indigo-200 space-y-1"
                    >
                      <p className="font-medium text-indigo-100">WireGuard no editable</p>
                      <p className="text-indigo-200/80">
                        Servidor en el VPS + peer único por router. Se crea al pulsar «Generar configuración».
                        Los campos siguientes son solo parámetros WISP (LAN, sitio, API).
                      </p>
                    </div>
                  )}
                  {paramSchema.groups.map((group) => (
                    <section key={group.id} data-testid={`param-group-${group.id}`}>
                      <p className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                        <Network size={12} className="text-orange-400" /> {group.label}
                      </p>
                      <div className="grid grid-cols-2 gap-2.5 p-3 bg-slate-800/40 border border-slate-700/40 rounded-xl">
                        {group.parameters.map((param) => renderField(group, param))}
                      </div>
                    </section>
                  ))}
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => stepTo(4)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
                  <ChevronLeft size={15} /> Atrás
                </button>
                <button
                  onClick={() => stepTo(6)}
                  disabled={paramsLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Siguiente <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Paso 6: Generar configuración ─────────────────────────── */}
          {step === 6 && (
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
                  ['Plantilla', getTemplateLabel(form.templateId)],
                  ['Parámetros', paramSchema
                    ? `${countConfiguredParameters(paramSchema, paramValues)} configurados`
                    : 'Configuración por defecto'],
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
                El script .rsc contiene la clave privada WireGuard del router
                {form.templateId === 'nugacore_factory_onboarding' ? ' y la comunidad SNMP' : ''}.
                Guárdalo de forma segura y elimínalo del equipo tras importarlo.
              </div>

              <div className="flex justify-between">
                <button onClick={() => stepTo(5)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
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

          {/* ── Paso 7: Descargar .rsc ────────────────────────────────── */}
          {step === 7 && startResult && (
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

              {startResult.snmpCommunity && (
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-300 text-xs">
                  <p className="font-medium text-indigo-200">Comunidad SNMP (mostrada una sola vez)</p>
                  <p className="font-mono mt-1">{startResult.snmpCommunity}</p>
                </div>
              )}

              {/* Vista previa sanitizada */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-mono">{fileName}</span>
                  <div className="flex gap-2">
                    <button onClick={copyFullScript} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                      {copied ? <CheckCircle size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      {copied ? 'Copiado' : 'Copiar script'}
                    </button>
                    <button onClick={copyPreview} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                      <Copy size={11} />
                      Copiar preview
                    </button>
                  </div>
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
                    onClick={() => stepTo(8)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition-colors"
                  >
                    Ya importé el script <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Paso 8: Confirmar online ──────────────────────────────── */}
          {step === 8 && startResult && (
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
                    {checkResult.snapshotSource === 'simulated' && (
                      <p className="text-xs text-amber-300/90 mt-1">
                        La verificación devolvió <strong>simulated</strong>: activa
                        {' '}<code className="font-mono">MIKROTIK_WORKER_LIVE=true</code> en staging (con autorización)
                        para confirmación live.
                      </p>
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
                <button onClick={() => stepTo(7)} className="flex items-center gap-1 px-3 py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors">
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
