import React, { useState, useEffect, useCallback } from 'react';
import { createAuthorizedApi } from '../lib/apiClient';
import {
  BookOpen,
  FileCode,
  Download,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  History,
  ChevronRight,
  Shield,
  Server,
  Network,
  Layers,
  Activity,
  Zap,
  Terminal,
  BarChart3,
  Filter,
} from 'lucide-react';
import { UserRole } from '../lib/supabase';
import { canGenerateTemplate, canViewTemplateHistory } from '../lib/routerosTemplatesRbac';

// ── Tipos locales ─────────────────────────────────────────────────

type TemplateCategory = 'core' | 'access' | 'tower' | 'balancer' | 'pppoe' | 'monitoring' | 'wireguard' | 'noc';

interface TemplateDescriptor {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  routerosVersion: string;
  tags: string[];
  features: string[];
  generatorVersion: string;
}

interface GenerateResponse {
  script: string;
  scriptPreview: string;
  scriptHash: string;
  filename: string;
  templateId: string;
  warnings: string[];
  generatedAt: string;
  apiUsername?: string;
  securityNotice: string;
}

interface HistoryEntry {
  id: string;
  templateId: string;
  routerName: string;
  filename: string;
  scriptHash: string;
  generatedAt: string;
  generatedBy?: string;
  warnings: string[];
}

interface RouterOsTemplatesModuleProps {
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

// ── Íconos por categoría ──────────────────────────────────────────

const categoryIcons: Record<TemplateCategory, React.ElementType> = {
  core:       Zap,
  access:     Network,
  tower:      Server,
  balancer:   Layers,
  pppoe:      BarChart3,
  monitoring: Activity,
  wireguard:  Shield,
  noc:        Terminal,
};

const categoryLabels: Record<TemplateCategory, string> = {
  core:       'Core',
  access:     'Access',
  tower:      'Tower',
  balancer:   'Balancer',
  pppoe:      'PPPoE',
  monitoring: 'Monitoring',
  wireguard:  'WireGuard',
  noc:        'NOC',
};

const categoryColors: Record<TemplateCategory, string> = {
  core:       'text-indigo-400 bg-indigo-900/30 border-indigo-800/40',
  access:     'text-sky-400 bg-sky-900/30 border-sky-800/40',
  tower:      'text-emerald-400 bg-emerald-900/30 border-emerald-800/40',
  balancer:   'text-violet-400 bg-violet-900/30 border-violet-800/40',
  pppoe:      'text-amber-400 bg-amber-900/30 border-amber-800/40',
  monitoring: 'text-cyan-400 bg-cyan-900/30 border-cyan-800/40',
  wireguard:  'text-rose-400 bg-rose-900/30 border-rose-800/40',
  noc:        'text-orange-400 bg-orange-900/30 border-orange-800/40',
};

const PCC_TEMPLATES = new Set(['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan']);

const wanCountOf = (id: string): number => {
  if (id === 'pcc_2wan') return 2;
  if (id === 'pcc_3wan') return 3;
  if (id === 'pcc_4wan') return 4;
  if (id === 'pcc_5wan') return 5;
  return 0;
};

// ── Componente principal ──────────────────────────────────────────

export default function RouterOsTemplatesModule({ userRole, getAuthHeaders }: RouterOsTemplatesModuleProps) {
  type View = 'catalog' | 'generator' | 'preview' | 'history';
  const [view, setView] = useState<View>('catalog');
  const [templates, setTemplates] = useState<TemplateDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | 'all'>('all');

  // Generador
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDescriptor | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);

  // Vista previa
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  // Historial
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Formulario dinámico
  const [form, setForm] = useState<Record<string, string>>({});
  const [wanIfaceCount, setWanIfaceCount] = useState(2);
  const [wanIfaces, setWanIfaces] = useState<string[]>(['', '']);
  const [wanGws, setWanGws] = useState<string[]>(['', '']);

  // Helper del módulo sobre el cliente central: conserva la firma histórica
  // (url + RequestInit) para no tocar los call sites.
  const fetchWithAuth = useCallback(
    async (url: string, init?: RequestInit) => {
      const api = createAuthorizedApi(getAuthHeaders);
      const method = (init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (method === 'POST') return api.post(url, body);
      if (method === 'PUT') return api.put(url, body);
      if (method === 'DELETE') return api.delete(url, body);
      return api.get(url);
    },
    [getAuthHeaders],
  );

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWithAuth('/api/routeros-templates/catalog');
      setTemplates(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar el catálogo');
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  const loadHistory = useCallback(async () => {
    if (!canViewTemplateHistory(userRole)) return;
    setHistoryLoading(true);
    try {
      const data = await fetchWithAuth('/api/routeros-templates/history');
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [fetchWithAuth, userRole]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (view === 'history') loadHistory();
  }, [view, loadHistory]);

  const handleSelectTemplate = (tpl: TemplateDescriptor) => {
    setSelectedTemplate(tpl);
    setForm({ routerName: '', routerosVersion: '7' });
    const count = wanCountOf(tpl.id);
    if (count > 0) {
      setWanIfaceCount(count);
      setWanIfaces(Array(count).fill(''));
      setWanGws(Array(count).fill(''));
    }
    setGenerated(null);
    setGenError('');
    setView('generator');
  };

  const handleGenerate = async () => {
    if (!selectedTemplate || !canGenerateTemplate(userRole)) return;
    setGenerating(true);
    setGenError('');

    const payload: Record<string, unknown> = {
      templateId: selectedTemplate.id,
      routerName: form.routerName || 'nugacore-router',
      routerosVersion: form.routerosVersion || '7',
    };

    if (selectedTemplate.id === 'nugacore_factory_onboarding') {
      payload.applyMode = 'factory_reset';
    } else {
      if (!form.applyMode) {
        setGenError('Selecciona si el router está en factory reset o ya tiene configuración.');
        setGenerating(false);
        return;
      }
      payload.applyMode = form.applyMode;
    }

    // LAN params
    if (form.lanBridgeName) payload.lanBridgeName = form.lanBridgeName;
    if (form.lanCidr) payload.lanCidr = form.lanCidr;
    if (form.lanGateway) payload.lanGateway = form.lanGateway;
    if (form.wanInterface) payload.wanInterface = form.wanInterface;
    if (form.dhcpPoolStart) payload.dhcpPoolStart = form.dhcpPoolStart;
    if (form.dhcpPoolEnd) payload.dhcpPoolEnd = form.dhcpPoolEnd;
    if (form.dnsServers) payload.dnsServers = form.dnsServers.split(',').map((s) => s.trim());
    if (form.apiCidr) payload.apiCidr = form.apiCidr;
    if (form.apiPort) payload.apiPort = parseInt(form.apiPort);

    // WireGuard
    if (form.wgServerPublicKey) payload.wgServerPublicKey = form.wgServerPublicKey;
    if (form.wgEndpoint) payload.wgEndpoint = form.wgEndpoint;
    if (form.wgRouterIp) payload.wgRouterIp = form.wgRouterIp;
    if (form.wgManagementCidr) payload.wgManagementCidr = form.wgManagementCidr;
    if (form.wgKeepalive) payload.wgKeepalive = parseInt(form.wgKeepalive);

    // SSTP
    if (form.sstpHost) payload.sstpHost = form.sstpHost;

    // PCC
    if (PCC_TEMPLATES.has(selectedTemplate.id)) {
      payload.wanInterfaces = wanIfaces.filter((v) => v.trim());
      payload.wanGateways = wanGws.filter((v) => v.trim());
      payload.pccEnableFailover = form.pccEnableFailover !== 'false';
      payload.pccEnableWatchdog = form.pccEnableWatchdog !== 'false';
    }

    // Tower
    if (selectedTemplate.id === 'tower_wisp') {
      if (form.vlanManagement) payload.vlanManagement = parseInt(form.vlanManagement);
      if (form.vlanClients) payload.vlanClients = parseInt(form.vlanClients);
      if (form.vlanBackhaul) payload.vlanBackhaul = parseInt(form.vlanBackhaul);
      payload.enableVlans = form.enableVlans !== 'false';
    }

    // PPPoE
    if (selectedTemplate.id === 'pppoe_server') {
      if (form.pppoeInterface) payload.pppoeInterface = form.pppoeInterface;
      if (form.pppoeServiceName) payload.pppoeServiceName = form.pppoeServiceName;
      if (form.pppoeLocalIp) payload.pppoeLocalIp = form.pppoeLocalIp;
      if (form.pppoeRemotePoolStart) payload.pppoeRemotePoolStart = form.pppoeRemotePoolStart;
      if (form.pppoeRemotePoolEnd) payload.pppoeRemotePoolEnd = form.pppoeRemotePoolEnd;
    }

    // Monitoring
    if (selectedTemplate.id === 'monitoring_agent') {
      if (form.watchdogTarget) payload.watchdogTarget = form.watchdogTarget;
      payload.enableAutoBackup = form.enableAutoBackup !== 'false';
      payload.enableWatchdog = form.enableWatchdog !== 'false';
    }

    // NOC
    if (selectedTemplate.id === 'noc_ready') {
      if (form.nocApiCidr) payload.nocApiCidr = form.nocApiCidr;
      payload.enableApiSsl = form.enableApiSsl === 'true';
    }

    try {
      const result = await fetchWithAuth('/api/routeros-templates/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setGenerated(result);
      setShowRaw(false);
      setView('preview');
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : 'Error al generar el script');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (!generated) return;
    try {
      // fetch nativo a propósito: la descarga es binaria (blob) y apiClient
      // está limitado al contrato JSON/text de la API.
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/routeros-templates/download/${generated.scriptHash}`, { headers });
      if (!res.ok) throw new Error('Script expirado');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = generated.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : 'Error al descargar');
    }
  };

  const handleCopy = () => {
    if (!generated) return;
    navigator.clipboard.writeText(showRaw ? generated.script : generated.scriptPreview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const filteredTemplates =
    categoryFilter === 'all' ? templates : templates.filter((t) => t.category === categoryFilter);

  const categories = Array.from(new Set(templates.map((t) => t.category))) as TemplateCategory[];

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">RouterOS Templates Library</h1>
            <p className="text-[11px] text-slate-400 font-mono">Fase 4.6.3 — 13 plantillas · 8 categorías</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {canViewTemplateHistory(userRole) && (
            <button
              onClick={() => setView('history')}
              className={`px-3 py-1.5 text-xs rounded-lg border flex items-center space-x-1.5 transition ${
                view === 'history'
                  ? 'bg-slate-700 border-slate-600 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Historial</span>
            </button>
          )}
          <button
            onClick={() => { setView('catalog'); loadCatalog(); }}
            className={`px-3 py-1.5 text-xs rounded-lg border flex items-center space-x-1.5 transition ${
              view === 'catalog'
                ? 'bg-slate-700 border-slate-600 text-white'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Catálogo</span>
          </button>
        </div>
      </div>

      {/* ── VISTA: Catálogo ── */}
      {view === 'catalog' && (
        <div className="space-y-4">
          {/* Filtro de categoría */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-2.5 py-1 text-[11px] rounded-md border transition ${
                categoryFilter === 'all'
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Todas
            </button>
            {categories.map((cat) => {
              const Icon = categoryIcons[cat];
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 text-[11px] rounded-md border flex items-center space-x-1 transition ${
                    categoryFilter === cat
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{categoryLabels[cat]}</span>
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="flex items-center space-x-2 py-10 justify-center text-slate-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Cargando catálogo...</span>
            </div>
          ) : error ? (
            <div className="flex items-center space-x-2 text-rose-400 text-xs">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredTemplates.map((tpl) => {
                const Icon = categoryIcons[tpl.category as TemplateCategory] || FileCode;
                const colorClass = categoryColors[tpl.category as TemplateCategory] || 'text-slate-400 bg-slate-900 border-slate-800';
                return (
                  <div
                    key={tpl.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 hover:border-indigo-700/50 transition-all cursor-pointer group"
                    onClick={() => canGenerateTemplate(userRole) && handleSelectTemplate(tpl)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${colorClass}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-mono ${colorClass}`}>
                        {categoryLabels[tpl.category as TemplateCategory] || tpl.category}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-white mb-1 leading-tight">{tpl.name}</h3>
                    <p className="text-[11px] text-slate-400 mb-3 leading-relaxed line-clamp-2">{tpl.description}</p>

                    {/* Features */}
                    <div className="flex flex-wrap gap-1 mb-3">
                      {tpl.features.slice(0, 4).map((f) => (
                        <span key={f} className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono">
                          {f}
                        </span>
                      ))}
                      {tpl.features.length > 4 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-500 rounded font-mono">
                          +{tpl.features.length - 4}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap gap-1">
                        {tpl.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-[10px] text-slate-500 font-mono">#{tag}</span>
                        ))}
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className="text-[10px] text-slate-500 font-mono">
                          ROS {tpl.routerosVersion === 'any' ? 'v6+' : `v${tpl.routerosVersion}+`}
                        </span>
                        {canGenerateTemplate(userRole) && (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 transition" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── VISTA: Generador ── */}
      {view === 'generator' && selectedTemplate && (
        <div className="space-y-4">
          {/* Breadcrumb */}
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <button onClick={() => setView('catalog')} className="hover:text-white transition">
              Catálogo
            </button>
            <ChevronRight className="w-3 h-3" />
            <span className="text-white">{selectedTemplate.name}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Info plantilla */}
            <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 h-fit">
              {(() => {
                const Icon = categoryIcons[selectedTemplate.category as TemplateCategory] || FileCode;
                const colorClass = categoryColors[selectedTemplate.category as TemplateCategory] || '';
                return (
                  <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${colorClass}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                );
              })()}
              <div>
                <h3 className="text-sm font-semibold text-white">{selectedTemplate.name}</h3>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{selectedTemplate.description}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 mb-1 font-mono uppercase tracking-wider">Features</p>
                <ul className="space-y-1">
                  {selectedTemplate.features.map((f) => (
                    <li key={f} className="flex items-center space-x-1.5 text-[11px] text-slate-300">
                      <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Formulario */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <h3 className="text-sm font-semibold text-white">Parámetros de generación</h3>

              {/* applyMode obligatorio: wizard vs router existente */}
              {selectedTemplate.id !== 'nugacore_factory_onboarding' && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-200">¿Cómo está el router destino? *</p>
                  <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="applyMode"
                      className="mt-0.5 accent-orange-500"
                      checked={form.applyMode === 'factory_reset'}
                      onChange={() => setField('applyMode', 'factory_reset')}
                    />
                    <span>
                      <span className="font-medium text-white">Factory reset / limpio</span>
                      {' — '}asume router recién reseteado (como el Wizard de alta). Cambia identity, DNS y firewall drop WAN.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="radio"
                      name="applyMode"
                      className="mt-0.5 accent-orange-500"
                      checked={form.applyMode === 'existing_config'}
                      onChange={() => setField('applyMode', 'existing_config')}
                    />
                    <span>
                      <span className="font-medium text-white">Ya tiene configuración</span>
                      {' — '}solo objetos NugaCore. No toca identity/DNS ni añade drop WAN.
                    </span>
                  </label>
                  {!form.applyMode && (
                    <p className="text-[10px] text-rose-400">Selecciona una opción antes de generar.</p>
                  )}
                </div>
              )}
              {selectedTemplate.id === 'nugacore_factory_onboarding' && (
                <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-3 text-[11px] text-emerald-200">
                  Esta plantilla siempre usa <span className="font-mono">factory_reset</span> (onboarding WISP post-reset).
                </div>
              )}

              {/* Comunes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Nombre del router *" value={form.routerName || ''} onChange={(v) => setField('routerName', v)} placeholder="mi-router-01" />
                <FormSelect label="RouterOS versión *" value={form.routerosVersion || '7'} onChange={(v) => setField('routerosVersion', v)} options={[{ value: '7', label: 'RouterOS v7' }, { value: '6', label: 'RouterOS v6' }]} />
              </div>

              {/* LAN básico (para la mayoría de plantillas) */}
              {!['pppoe_server', 'monitoring_agent', 'wireguard_client', 'wireguard_server'].includes(selectedTemplate.id) && (
                <>
                  <SectionLabel>Red LAN</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Bridge LAN" value={form.lanBridgeName || ''} onChange={(v) => setField('lanBridgeName', v)} placeholder="bridge-lan" />
                    <FormField label="Interface WAN" value={form.wanInterface || ''} onChange={(v) => setField('wanInterface', v)} placeholder="ether1" />
                    <FormField label="LAN CIDR" value={form.lanCidr || ''} onChange={(v) => setField('lanCidr', v)} placeholder="192.168.1.0/24" />
                    <FormField label="Gateway LAN" value={form.lanGateway || ''} onChange={(v) => setField('lanGateway', v)} placeholder="192.168.1.1" />
                    <FormField label="DHCP pool inicio" value={form.dhcpPoolStart || ''} onChange={(v) => setField('dhcpPoolStart', v)} placeholder="192.168.1.10" />
                    <FormField label="DHCP pool fin" value={form.dhcpPoolEnd || ''} onChange={(v) => setField('dhcpPoolEnd', v)} placeholder="192.168.1.254" />
                    <FormField label="DNS (separados por coma)" value={form.dnsServers || ''} onChange={(v) => setField('dnsServers', v)} placeholder="8.8.8.8,1.1.1.1" />
                    <FormField label="API CIDR gestión" value={form.apiCidr || ''} onChange={(v) => setField('apiCidr', v)} placeholder="10.0.0.0/24" />
                  </div>
                </>
              )}

              {/* WireGuard */}
              {['router_base_wireguard', 'tower_wisp', 'wireguard_client', 'wireguard_server', 'client_residential'].includes(selectedTemplate.id) && (
                <>
                  <SectionLabel>WireGuard</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Public Key del servidor" value={form.wgServerPublicKey || ''} onChange={(v) => setField('wgServerPublicKey', v)} placeholder="<Base64 public key>" className="sm:col-span-2" />
                    <FormField label="Endpoint (host:port)" value={form.wgEndpoint || ''} onChange={(v) => setField('wgEndpoint', v)} placeholder="vpn.miempresa.com:13231" />
                    <FormField label="IP del peer (CIDR)" value={form.wgRouterIp || ''} onChange={(v) => setField('wgRouterIp', v)} placeholder="10.10.0.2/24" />
                    <FormField label="CIDR de gestión" value={form.wgManagementCidr || ''} onChange={(v) => setField('wgManagementCidr', v)} placeholder="10.10.0.0/24" />
                    <FormField label="Keepalive (segundos)" value={form.wgKeepalive || ''} onChange={(v) => setField('wgKeepalive', v)} placeholder="25" />
                  </div>
                </>
              )}

              {/* SSTP */}
              {selectedTemplate.id === 'router_base_sstp' && (
                <>
                  <SectionLabel>SSTP</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Host concentrador SSTP *" value={form.sstpHost || ''} onChange={(v) => setField('sstpHost', v)} placeholder="vpn.miempresa.com" />
                    <FormField label="CIDR de gestión" value={form.sstpManagementCidr || ''} onChange={(v) => setField('sstpManagementCidr', v)} placeholder="10.10.0.0/24" />
                  </div>
                </>
              )}

              {/* PCC */}
              {PCC_TEMPLATES.has(selectedTemplate.id) && (
                <>
                  <SectionLabel>Interfaces WAN ({wanIfaceCount} WANs)</SectionLabel>
                  {Array.from({ length: wanIfaceCount }).map((_, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormField
                        label={`Interface WAN${i + 1}`}
                        value={wanIfaces[i] || ''}
                        onChange={(v) => setWanIfaces((prev) => { const a = [...prev]; a[i] = v; return a; })}
                        placeholder={`ether${i + 1}`}
                      />
                      <FormField
                        label={`Gateway WAN${i + 1}`}
                        value={wanGws[i] || ''}
                        onChange={(v) => setWanGws((prev) => { const a = [...prev]; a[i] = v; return a; })}
                        placeholder={`10.0.${i}.1`}
                      />
                    </div>
                  ))}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormSelect label="Failover automático" value={form.pccEnableFailover ?? 'true'} onChange={(v) => setField('pccEnableFailover', v)} options={[{ value: 'true', label: 'Habilitado' }, { value: 'false', label: 'Deshabilitado' }]} />
                    <FormSelect label="Watchdog PCC" value={form.pccEnableWatchdog ?? 'true'} onChange={(v) => setField('pccEnableWatchdog', v)} options={[{ value: 'true', label: 'Habilitado' }, { value: 'false', label: 'Deshabilitado' }]} />
                  </div>
                </>
              )}

              {/* Tower */}
              {selectedTemplate.id === 'tower_wisp' && (
                <>
                  <SectionLabel>VLANs Torre</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormSelect label="Habilitar VLANs" value={form.enableVlans ?? 'true'} onChange={(v) => setField('enableVlans', v)} options={[{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }]} />
                    <FormField label="VLAN Management" value={form.vlanManagement || ''} onChange={(v) => setField('vlanManagement', v)} placeholder="100" />
                    <FormField label="VLAN Clientes" value={form.vlanClients || ''} onChange={(v) => setField('vlanClients', v)} placeholder="200" />
                    <FormField label="VLAN Backhaul" value={form.vlanBackhaul || ''} onChange={(v) => setField('vlanBackhaul', v)} placeholder="300" />
                  </div>
                </>
              )}

              {/* PPPoE */}
              {selectedTemplate.id === 'pppoe_server' && (
                <>
                  <SectionLabel>Servidor PPPoE</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Interface PPPoE" value={form.pppoeInterface || ''} onChange={(v) => setField('pppoeInterface', v)} placeholder="bridge-lan" />
                    <FormField label="Nombre del servicio" value={form.pppoeServiceName || ''} onChange={(v) => setField('pppoeServiceName', v)} placeholder="pppoe-nugacore" />
                    <FormField label="IP local (concentrador)" value={form.pppoeLocalIp || ''} onChange={(v) => setField('pppoeLocalIp', v)} placeholder="10.100.0.1" />
                    <FormField label="Pool inicio" value={form.pppoeRemotePoolStart || ''} onChange={(v) => setField('pppoeRemotePoolStart', v)} placeholder="10.100.0.2" />
                    <FormField label="Pool fin" value={form.pppoeRemotePoolEnd || ''} onChange={(v) => setField('pppoeRemotePoolEnd', v)} placeholder="10.100.0.254" />
                  </div>
                </>
              )}

              {/* Monitoring */}
              {selectedTemplate.id === 'monitoring_agent' && (
                <>
                  <SectionLabel>Monitoreo</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Target watchdog (IP)" value={form.watchdogTarget || ''} onChange={(v) => setField('watchdogTarget', v)} placeholder="8.8.8.8" />
                    <FormSelect label="Auto Backup" value={form.enableAutoBackup ?? 'true'} onChange={(v) => setField('enableAutoBackup', v)} options={[{ value: 'true', label: 'Habilitado' }, { value: 'false', label: 'Deshabilitado' }]} />
                    <FormSelect label="Watchdog" value={form.enableWatchdog ?? 'true'} onChange={(v) => setField('enableWatchdog', v)} options={[{ value: 'true', label: 'Habilitado' }, { value: 'false', label: 'Deshabilitado' }]} />
                  </div>
                </>
              )}

              {/* NOC */}
              {selectedTemplate.id === 'noc_ready' && (
                <>
                  <SectionLabel>NOC</SectionLabel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="CIDR gestión API" value={form.nocApiCidr || ''} onChange={(v) => setField('nocApiCidr', v)} placeholder="10.0.0.0/24" />
                    <FormField label="Puerto API" value={form.apiPort || ''} onChange={(v) => setField('apiPort', v)} placeholder="8728" />
                    <FormSelect label="API-SSL" value={form.enableApiSsl ?? 'false'} onChange={(v) => setField('enableApiSsl', v)} options={[{ value: 'false', label: 'Deshabilitado' }, { value: 'true', label: 'Habilitado' }]} />
                  </div>
                </>
              )}

              {genError && (
                <div className="flex items-center space-x-2 text-rose-400 text-xs bg-rose-950/30 border border-rose-900/40 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{genError}</span>
                </div>
              )}

              <div className="flex items-center space-x-3 pt-2">
                <button
                  onClick={handleGenerate}
                  disabled={
                    !canGenerateTemplate(userRole) ||
                    generating ||
                    (selectedTemplate.id !== 'nugacore_factory_onboarding' && !form.applyMode)
                  }
                  className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded-lg transition font-semibold"
                >
                  {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
                  <span>{generating ? 'Generando...' : 'Generar Script'}</span>
                </button>
                <button
                  onClick={() => setView('catalog')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VISTA: Preview ── */}
      {view === 'preview' && generated && (
        <div className="space-y-4">
          {/* Breadcrumb */}
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <button onClick={() => setView('catalog')} className="hover:text-white transition">Catálogo</button>
            <ChevronRight className="w-3 h-3" />
            <button onClick={() => setView('generator')} className="hover:text-white transition">Generador</button>
            <ChevronRight className="w-3 h-3" />
            <span className="text-white">Vista Previa</span>
          </div>

          {/* Security notice */}
          <div className="flex items-start space-x-3 bg-amber-950/30 border border-amber-900/40 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-300">{generated.securityNotice}</p>
              {generated.apiUsername && (
                <p className="text-[11px] text-amber-400 mt-1 font-mono">
                  Usuario API generado: <strong>{generated.apiUsername}</strong>
                </p>
              )}
            </div>
          </div>

          {/* Warnings */}
          {generated.warnings.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1">
              {generated.warnings.map((w, i) => (
                <div key={i} className="flex items-start space-x-2 text-[11px] text-amber-300">
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Script viewer */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center space-x-3">
                <FileCode className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-mono text-slate-300">{generated.filename}</span>
                <span className="text-[10px] font-mono text-slate-500">
                  #{generated.scriptHash.substring(0, 8)}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowRaw(!showRaw)}
                  title={showRaw ? 'Ocultar secretos' : 'Mostrar script completo'}
                  className="p-1.5 rounded text-slate-400 hover:text-white transition"
                >
                  {showRaw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleCopy}
                  className="p-1.5 rounded text-slate-400 hover:text-white transition"
                  title="Copiar"
                >
                  {copied ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar .rsc</span>
                </button>
              </div>
            </div>

            {showRaw && (
              <div className="px-4 py-2 bg-rose-950/30 border-b border-rose-900/30 text-[11px] text-rose-300 flex items-center space-x-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Script completo visible — contiene credenciales en claro. No compartas esta vista.</span>
              </div>
            )}

            <pre className="p-4 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-[500px] overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {showRaw ? generated.script : generated.scriptPreview}
            </pre>
          </div>
        </div>
      )}

      {/* ── VISTA: Historial ── */}
      {view === 'history' && canViewTemplateHistory(userRole) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Historial de generaciones</h2>
            <button onClick={loadHistory} className="p-1.5 rounded text-slate-400 hover:text-white transition" title="Actualizar">
              <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {historyLoading ? (
            <div className="flex items-center space-x-2 text-slate-400 text-xs py-8 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Cargando historial...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              <History className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>No hay generaciones registradas aún.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-left">
                    <th className="pb-2 pr-4 font-medium">Plantilla</th>
                    <th className="pb-2 pr-4 font-medium">Router</th>
                    <th className="pb-2 pr-4 font-medium">Archivo</th>
                    <th className="pb-2 pr-4 font-medium">Hash</th>
                    <th className="pb-2 font-medium">Generado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {history.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-900/50 transition">
                      <td className="py-2.5 pr-4 font-mono text-indigo-300">{entry.templateId}</td>
                      <td className="py-2.5 pr-4 text-slate-300">{entry.routerName}</td>
                      <td className="py-2.5 pr-4 text-slate-400 font-mono max-w-[200px] truncate">{entry.filename}</td>
                      <td className="py-2.5 pr-4 text-slate-500 font-mono">{entry.scriptHash.substring(0, 12)}…</td>
                      <td className="py-2.5 text-slate-500 whitespace-nowrap">
                        {new Date(entry.generatedAt).toLocaleString('es-AR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-componentes reutilizables ─────────────────────────────────

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}

const FormField = ({ label, value, onChange, placeholder, className = '' }: FormFieldProps) => (
  <div className={className}>
    <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition font-mono"
    />
  </div>
);

interface FormSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

const FormSelect = ({ label, value, onChange, options }: FormSelectProps) => (
  <div>
    <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="pt-1 pb-0.5">
    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider font-mono">{children}</p>
    <div className="h-px bg-slate-800 mt-1" />
  </div>
);
