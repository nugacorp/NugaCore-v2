import React, { useState, useEffect, useCallback } from 'react';
import {
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
  Wifi,
  Server,
} from 'lucide-react';
import { UserRole } from '../lib/supabase';
import { canGenerateResource, canViewHistory } from '../lib/routerosResourcesRbac';

// ── Tipos locales ─────────────────────────────────────────────────────

interface TemplateDescriptor {
  id: string;
  name: string;
  description: string;
  category: 'production' | 'lab';
  rosVersionRequired: string;
  features: string[];
}

interface GenerateResponse {
  script: string;
  scriptPreview: string;
  scriptHash: string;
  filename: string;
  templateId: string;
  warnings: string[];
  generatedAt: string;
  apiUsername: string;
  securityNotice: string;
}

interface HistoryEntry {
  id: string;
  templateId: string;
  routerName: string;
  filename: string;
  scriptHash: string;
  generatedAt: string;
  warnings: string[];
}

interface FormParams {
  templateId: string;
  routerName: string;
  lanBridgeName: string;
  lanCidr: string;
  lanGateway: string;
  dhcpPoolStart: string;
  dhcpPoolEnd: string;
  dnsServers: string;
  wanInterface: string;
  lanInterfaces: string;
  enableNat: boolean;
  enableBasicFirewall: boolean;
  enableDhcpServer: boolean;
  routerosVersion: '6' | '7';
  apiMode: 'readonly' | 'operator';
  apiPort: number;
  // WireGuard
  wgServerPublicKey: string;
  wgEndpoint: string;
  wgRouterIp: string;
  wgManagementCidr: string;
  wgVpnCidr: string;
  wgKeepalive: number;
  // SSTP
  sstpHost: string;
  sstpManagementCidr: string;
  sstpVpnCidr: string;
}

const DEFAULT_PARAMS: FormParams = {
  templateId: 'base_wisp_wireguard',
  routerName: 'NUGACORE-WISP-ROUTER',
  lanBridgeName: 'bridgeLAN',
  lanCidr: '192.168.88.0/24',
  lanGateway: '192.168.88.1',
  dhcpPoolStart: '192.168.88.10',
  dhcpPoolEnd: '192.168.88.254',
  dnsServers: '1.1.1.1,8.8.8.8',
  wanInterface: 'ether1',
  lanInterfaces: 'ether2,ether3,ether4,ether5',
  enableNat: true,
  enableBasicFirewall: true,
  enableDhcpServer: true,
  routerosVersion: '7',
  apiMode: 'operator',
  apiPort: 8728,
  wgServerPublicKey: '',
  wgEndpoint: '',
  wgRouterIp: '',
  wgManagementCidr: '10.10.0.0/24',
  wgVpnCidr: '10.10.0.0/24',
  wgKeepalive: 25,
  sstpHost: '',
  sstpManagementCidr: '10.10.0.0/24',
  sstpVpnCidr: '10.10.0.0/24',
};

// ── Componente principal ──────────────────────────────────────────────

interface Props {
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function RouterOsResourcesModule({ userRole, getAuthHeaders }: Props) {
  const [templates, setTemplates] = useState<TemplateDescriptor[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDescriptor | null>(null);
  const [params, setParams] = useState<FormParams>(DEFAULT_PARAMS);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [showFullScript, setShowFullScript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'catalog' | 'form' | 'preview' | 'history'>('catalog');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');

  const canGenerate = canGenerateResource(userRole);
  const canSeeHistory = canViewHistory(userRole);

  const fetchJson = useCallback(
    async (url: string, init?: RequestInit) => {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, {
        ...init,
        headers: { ...authHeaders, ...(init?.headers || {}) },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    [getAuthHeaders],
  );

  useEffect(() => {
    fetchJson('/api/routeros-resources/templates')
      .then((data) => {
        setTemplates(data);
        if (data.length > 0) setSelectedTemplate(data[0]);
      })
      .catch(() => setError('No se pudieron cargar las plantillas.'));
  }, [fetchJson]);

  const loadHistory = async () => {
    if (!canSeeHistory) return;
    setLoadingHistory(true);
    try {
      const data = await fetchJson('/api/routeros-resources/history');
      setHistory(data);
    } catch {
      // historial no crítico
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSelectTemplate = (t: TemplateDescriptor) => {
    setSelectedTemplate(t);
    setParams((prev) => ({
      ...prev,
      templateId: t.id,
      routerosVersion: t.rosVersionRequired === '7' ? '7' : prev.routerosVersion,
    }));
    setResult(null);
    setActiveTab('form');
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError('');
    setResult(null);
    try {
      const payload = {
        ...params,
        dnsServers: params.dnsServers.split(',').map((s) => s.trim()).filter(Boolean),
        lanInterfaces: params.lanInterfaces.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const data = await fetchJson('/api/routeros-resources/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setResult(data);
      setShowFullScript(false);
      setActiveTab('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al generar el script.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result.script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updateParam = <K extends keyof FormParams>(key: K, value: FormParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  };

  // ── Render: catálogo de plantillas ────────────────────────────────

  const renderCatalog = () => (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-6">
        <FileCode className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-white">Plantillas RouterOS</h2>
        <span className="text-xs text-slate-500">Selecciona una plantilla para configurarla</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {templates.map((t) => {
          const isProduction = t.category === 'production';
          return (
            <button
              key={t.id}
              onClick={() => handleSelectTemplate(t)}
              className={`text-left p-4 rounded-xl border transition-all ${
                selectedTemplate?.id === t.id
                  ? 'border-indigo-500 bg-indigo-950/40'
                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <span
                  className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    isProduction
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                      : 'bg-amber-950/60 text-amber-400 border border-amber-800/50'
                  }`}
                >
                  {isProduction ? 'Producción' : 'Laboratorio'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  ROS v{t.rosVersionRequired}
                </span>
              </div>
              <p className="text-xs font-bold text-white mb-1">{t.name}</p>
              <p className="text-[11px] text-slate-400 mb-3 line-clamp-2">{t.description}</p>
              <div className="flex flex-wrap gap-1">
                {t.features.map((f) => (
                  <span
                    key={f}
                    className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded"
                  >
                    {f}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center text-indigo-400 text-[11px] font-medium">
                <span>Configurar</span>
                <ChevronRight className="w-3 h-3 ml-0.5" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Render: formulario de parámetros ─────────────────────────────

  const Field = ({
    label,
    hint,
    children,
  }: {
    label: string;
    hint?: string;
    children: React.ReactNode;
  }) => (
    <div>
      <label className="block text-[11px] font-medium text-slate-400 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-600 mt-0.5">{hint}</p>}
    </div>
  );

  const inputCls =
    'w-full bg-slate-900 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 font-mono';

  const renderForm = () => (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setActiveTab('catalog')}
          className="text-xs text-slate-500 hover:text-slate-300 transition"
        >
          Plantillas
        </button>
        <ChevronRight className="w-3 h-3 text-slate-600" />
        <span className="text-xs text-white">{selectedTemplate?.name}</span>
      </div>

      {/* Sección: Identificación */}
      <section>
        <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-widest mb-3">
          Identificación
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nombre del router" hint="Máx. 64 caracteres. Se aplica como system identity.">
            <input
              className={inputCls}
              value={params.routerName}
              onChange={(e) => updateParam('routerName', e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field label="RouterOS versión">
            <select
              className={inputCls}
              value={params.routerosVersion}
              onChange={(e) => updateParam('routerosVersion', e.target.value as '6' | '7')}
            >
              <option value="7">v7 (recomendado)</option>
              <option value="6">v6</option>
            </select>
          </Field>
        </div>
      </section>

      {/* Sección: Red LAN */}
      <section>
        <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-widest mb-3">
          Red LAN
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Nombre del bridge LAN">
            <input
              className={inputCls}
              value={params.lanBridgeName}
              onChange={(e) => updateParam('lanBridgeName', e.target.value)}
            />
          </Field>
          <Field label="CIDR LAN" hint="ej: 192.168.88.0/24">
            <input
              className={inputCls}
              value={params.lanCidr}
              onChange={(e) => updateParam('lanCidr', e.target.value)}
            />
          </Field>
          <Field label="Gateway LAN">
            <input
              className={inputCls}
              value={params.lanGateway}
              onChange={(e) => updateParam('lanGateway', e.target.value)}
            />
          </Field>
          <Field label="Interfaz WAN" hint="La interfaz conectada al ISP (ej: ether1)">
            <input
              className={inputCls}
              value={params.wanInterface}
              onChange={(e) => updateParam('wanInterface', e.target.value)}
            />
          </Field>
          <Field
            label="Interfaces LAN"
            hint="Separadas por comas. Se agregarán al bridge (ej: ether2,ether3,ether4)"
          >
            <input
              className={inputCls}
              value={params.lanInterfaces}
              onChange={(e) => updateParam('lanInterfaces', e.target.value)}
            />
          </Field>
          <Field label="DNS servers" hint="Separados por comas (ej: 1.1.1.1,8.8.8.8)">
            <input
              className={inputCls}
              value={params.dnsServers}
              onChange={(e) => updateParam('dnsServers', e.target.value)}
            />
          </Field>
        </div>
      </section>

      {/* Sección: DHCP */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-widest">DHCP</h3>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={params.enableDhcpServer}
              onChange={(e) => updateParam('enableDhcpServer', e.target.checked)}
              className="rounded"
            />
            <span className="text-[11px] text-slate-400">Habilitar</span>
          </label>
        </div>
        {params.enableDhcpServer && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Pool inicio">
              <input
                className={inputCls}
                value={params.dhcpPoolStart}
                onChange={(e) => updateParam('dhcpPoolStart', e.target.value)}
              />
            </Field>
            <Field label="Pool fin">
              <input
                className={inputCls}
                value={params.dhcpPoolEnd}
                onChange={(e) => updateParam('dhcpPoolEnd', e.target.value)}
              />
            </Field>
          </div>
        )}
      </section>

      {/* Sección: Seguridad */}
      <section>
        <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-widest mb-3">
          Seguridad
        </h3>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={params.enableNat}
              onChange={(e) => updateParam('enableNat', e.target.checked)}
            />
            <span className="text-[11px] text-slate-300">NAT masquerade</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={params.enableBasicFirewall}
              onChange={(e) => updateParam('enableBasicFirewall', e.target.checked)}
            />
            <span className="text-[11px] text-slate-300">Firewall básico (drop WAN input)</span>
          </label>
        </div>
      </section>

      {/* Sección: API NugaCore */}
      <section>
        <h3 className="text-[11px] font-bold uppercase text-slate-500 tracking-widest mb-3">
          API NugaCore
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Puerto API" hint="Por defecto: 8728">
            <input
              className={inputCls}
              type="number"
              value={params.apiPort}
              onChange={(e) => updateParam('apiPort', parseInt(e.target.value, 10))}
              min={1}
              max={65535}
            />
          </Field>
          <Field label="Modo API">
            <select
              className={inputCls}
              value={params.apiMode}
              onChange={(e) => updateParam('apiMode', e.target.value as 'readonly' | 'operator')}
            >
              <option value="operator">Operador (read,write,api,test)</option>
              <option value="readonly">Solo lectura (read,api,test)</option>
            </select>
          </Field>
        </div>
      </section>

      {/* Sección: WireGuard */}
      {params.templateId === 'base_wisp_wireguard' && (
        <section className="border border-indigo-900/40 rounded-xl p-4 bg-indigo-950/10">
          <div className="flex items-center gap-2 mb-3">
            <Wifi className="w-4 h-4 text-indigo-400" />
            <h3 className="text-[11px] font-bold uppercase text-indigo-400 tracking-widest">
              WireGuard (NugaCore Server)
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 mb-4">
            El router generará su propia private-key automáticamente. Tras ejecutar el script,
            copia la public-key del router y regístrala en NugaCore.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Public key del servidor NugaCore"
              hint="La clave pública del servidor WireGuard de NugaCore"
            >
              <input
                className={inputCls}
                value={params.wgServerPublicKey}
                onChange={(e) => updateParam('wgServerPublicKey', e.target.value)}
                placeholder="<pegar public key del servidor>"
              />
            </Field>
            <Field label="Endpoint del servidor" hint="host:puerto (ej: vpn.nugacore.net:13231)">
              <input
                className={inputCls}
                value={params.wgEndpoint}
                onChange={(e) => updateParam('wgEndpoint', e.target.value)}
                placeholder="vpn.nugacore.net:13231"
              />
            </Field>
            <Field
              label="IP del router en la red WG"
              hint="ej: 10.10.0.5/32 — IP que tendrá este router en la VPN"
            >
              <input
                className={inputCls}
                value={params.wgRouterIp}
                onChange={(e) => updateParam('wgRouterIp', e.target.value)}
                placeholder="10.10.0.5/32"
              />
            </Field>
            <Field label="CIDR de gestión NugaCore" hint="Red de administración de NugaCore (ej: 10.10.0.0/24)">
              <input
                className={inputCls}
                value={params.wgManagementCidr}
                onChange={(e) => updateParam('wgManagementCidr', e.target.value)}
              />
            </Field>
            <Field label="Keepalive (segundos)" hint="Persistent keepalive para NAT traversal">
              <input
                className={inputCls}
                type="number"
                value={params.wgKeepalive}
                onChange={(e) => updateParam('wgKeepalive', parseInt(e.target.value, 10))}
                min={0}
                max={120}
              />
            </Field>
          </div>
        </section>
      )}

      {/* Sección: SSTP */}
      {params.templateId === 'base_wisp_sstp' && (
        <section className="border border-purple-900/40 rounded-xl p-4 bg-purple-950/10">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-purple-400" />
            <h3 className="text-[11px] font-bold uppercase text-purple-400 tracking-widest">
              SSTP (NugaCore Server)
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Host del concentrador SSTP" hint="FQDN o IP del servidor SSTP de NugaCore">
              <input
                className={inputCls}
                value={params.sstpHost}
                onChange={(e) => updateParam('sstpHost', e.target.value)}
                placeholder="sstp.nugacore.net"
              />
            </Field>
            <Field label="CIDR de gestión NugaCore">
              <input
                className={inputCls}
                value={params.sstpManagementCidr}
                onChange={(e) => updateParam('sstpManagementCidr', e.target.value)}
              />
            </Field>
          </div>
        </section>
      )}

      {/* Botón Generar */}
      {canGenerate && (
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs font-bold rounded-lg transition"
          >
            {generating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileCode className="w-3.5 h-3.5" />
            )}
            {generating ? 'Generando...' : 'Generar Script .rsc'}
          </button>
          <p className="text-[10px] text-amber-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Haz backup del router antes de importar
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-950/30 border border-rose-900/40 rounded-lg text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );

  // ── Render: vista previa del script ──────────────────────────────

  const renderPreview = () => {
    if (!result) return null;
    return (
      <div className="space-y-4 max-w-4xl">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setActiveTab('form')}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Formulario
          </button>
          <ChevronRight className="w-3 h-3 text-slate-600" />
          <span className="text-xs text-white">Vista previa</span>
        </div>

        {/* Banner de seguridad */}
        <div className="flex items-start gap-3 p-3 bg-amber-950/40 border border-amber-800/50 rounded-lg">
          <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-300">Los secretos se muestran una sola vez</p>
            <p className="text-[11px] text-amber-400/80 mt-0.5">{result.securityNotice}</p>
          </div>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className="space-y-1.5">
            {result.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-2.5 bg-yellow-950/30 border border-yellow-900/30 rounded-lg text-[11px] text-yellow-300"
              >
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Archivo', value: result.filename },
            { label: 'Usuario API', value: result.apiUsername },
            { label: 'Hash SHA256', value: result.scriptHash.substring(0, 16) + '…' },
            { label: 'Generado', value: new Date(result.generatedAt).toLocaleTimeString() },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-900/60 rounded-lg p-3 border border-slate-800">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
              <p className="text-xs text-slate-200 font-mono mt-0.5 truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Controles */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar {result.filename.split('/').pop()}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-lg transition"
          >
            {copied ? (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? 'Copiado' : 'Copiar script'}
          </button>
          <button
            onClick={() => setShowFullScript((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-400 hover:text-white text-xs rounded-lg border border-slate-700 hover:border-slate-500 transition"
          >
            {showFullScript ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            {showFullScript ? 'Ocultar secretos' : 'Mostrar script completo'}
          </button>
        </div>

        {/* Script */}
        <div className="relative">
          {!showFullScript && (
            <div className="absolute top-2 right-2 z-10">
              <span className="text-[10px] bg-amber-900/60 text-amber-400 px-2 py-0.5 rounded font-mono border border-amber-800/40">
                SECRETOS REDACTADOS
              </span>
            </div>
          )}
          <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-300 font-mono overflow-x-auto overflow-y-auto max-h-[500px] whitespace-pre leading-relaxed">
            {showFullScript ? result.script : result.scriptPreview}
          </pre>
        </div>

        <div className="text-[10px] text-slate-600 font-mono">
          sha256: {result.scriptHash}
        </div>

        <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg text-[11px] text-slate-400">
          <strong className="text-slate-300">Cómo importar en RouterOS:</strong>
          <br />
          Copia el archivo al router vía Winbox o FTP, luego ejecuta:
          <br />
          <code className="text-indigo-300 font-mono">/import file-name={result.filename}</code>
        </div>
      </div>
    );
  };

  // ── Render: historial ────────────────────────────────────────────

  const renderHistory = () => (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-white">Historial de generaciones</h3>
        </div>
        <button
          onClick={loadHistory}
          disabled={loadingHistory}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Solo se almacenan metadatos. El script con credenciales nunca se persiste.
      </p>
      {history.length === 0 ? (
        <div className="text-center py-12 text-slate-600 text-xs">Sin generaciones registradas aún.</div>
      ) : (
        <div className="space-y-2">
          {history.map((h) => (
            <div
              key={h.id}
              className="flex items-start justify-between p-3 bg-slate-900/50 border border-slate-800 rounded-lg"
            >
              <div>
                <p className="text-xs font-medium text-slate-200">{h.routerName}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">{h.filename}</p>
                <p className="text-[10px] text-slate-600 font-mono">
                  {h.scriptHash.substring(0, 16)}…
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-500">
                  {new Date(h.generatedAt).toLocaleString()}
                </p>
                <span className="text-[10px] font-mono text-slate-600">{h.templateId}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Layout principal ──────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <FileCode className="w-5 h-5 text-indigo-400" />
            Recursos MikroTik
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Generador de scripts RouterOS seguros para WISP. Los secretos se muestran una sola vez.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-800 pb-0">
        {(
          [
            { id: 'catalog', label: 'Plantillas', icon: FileCode },
            { id: 'form', label: 'Configurar', icon: Shield },
            { id: 'preview', label: 'Vista previa', icon: Eye },
            ...(canSeeHistory ? [{ id: 'history', label: 'Historial', icon: History }] : []),
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id as typeof activeTab);
              if (id === 'history') loadHistory();
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition -mb-px ${
              activeTab === id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === 'preview' && result && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      {/* Contenido de cada tab */}
      <div>
        {activeTab === 'catalog' && renderCatalog()}
        {activeTab === 'form' && renderForm()}
        {activeTab === 'preview' && (result ? renderPreview() : (
          <div className="text-center py-16 text-slate-600 text-xs">
            Genera un script primero desde la pestaña Configurar.
          </div>
        ))}
        {activeTab === 'history' && renderHistory()}
      </div>
    </div>
  );
}
