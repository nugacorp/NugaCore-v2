import React, { useState, useEffect, useCallback } from 'react';
import { createAuthorizedApi } from '../lib/apiClient';
import {
  Wifi,
  Server,
  Shield,
  Download,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Eye,
  EyeOff,
  Copy,
  Terminal,
  Clock,
  XCircle,
  List,
  Plus,
  Trash2,
} from 'lucide-react';
import { UserRole } from '../lib/supabase';
import { canStartEnrollment, canRevokeEnrollment } from '../lib/enrollmentRbac';

// ── Tipos locales ──────────────────────────────────────────────────────

interface WgServer {
  id: string;
  name: string;
  endpointHost: string;
  endpointPort: number;
  vpnCidr: string;
  peersCount: number;
  status: string;
}

type EnrollmentStatus =
  | 'draft'
  | 'script_generated'
  | 'script_downloaded'
  | 'waiting_for_router'
  | 'online'
  | 'failed'
  | 'revoked';

interface EnrollmentView {
  id: string;
  routerId: string;
  routerName?: string;
  wgServerId: string;
  wgPeerId: string;
  enrolledBy: string;
  status: EnrollmentStatus;
  statusLabel: string;
  scriptHash?: string;
  scriptDownloadedAt?: string;
  checkOnlineAttempts: number;
  lastCheckAt?: string;
  onlineConfirmedAt?: string;
  failureReason?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface StartResult {
  enrollment: EnrollmentView;
  routerId: string;
  wgPeerId: string;
  wgAssignedIp: string;
  wgServerPublicKey: string;
  script: string;
  scriptFilename: string;
  scriptHash: string;
  securityWarning: string;
}

interface CheckOnlineResult {
  enrollment: EnrollmentView;
  isOnline: boolean;
  snapshotSource: 'live' | 'simulated' | null;
  message: string;
}

interface WizardForm {
  routerName: string;
  ipAddress: string;
  apiPort: string;
  linkedTowerId: string;
  wgServerId: string;
  routerosVersion: '6' | '7';
  lanBridgeName: string;
  lanCidr: string;
  lanGateway: string;
  wanInterface: string;
  notes: string;
}

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

// ── Helpers ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<EnrollmentStatus, string> = {
  draft: 'bg-gray-700 text-gray-300',
  script_generated: 'bg-blue-900 text-blue-300',
  script_downloaded: 'bg-indigo-900 text-indigo-300',
  waiting_for_router: 'bg-yellow-900 text-yellow-300',
  online: 'bg-green-900 text-green-300',
  failed: 'bg-red-900 text-red-300',
  revoked: 'bg-gray-800 text-gray-400',
};

const STEP_LABELS = [
  'Datos del router',
  'Servidor WireGuard',
  'Config LAN',
  'Generar script',
  'Descargar',
  'Importar',
  'Confirmar online',
];

const sanitizeScript = (script: string): string =>
  script
    .replace(/private-key="[^"]+"/g, 'private-key="[OCULTO]"')
    .replace(/password="[^"]+"/g, 'password="[OCULTO]"')
    .replace(/preshared-key="[^"]+"/g, 'preshared-key="[OCULTO]"');

// ── Componente principal ───────────────────────────────────────────────

export default function RouterEnrollmentWizard({ userRole, getAuthHeaders }: Props) {
  const [view, setView] = useState<'list' | 'wizard'>('list');
  const [step, setStep] = useState(1);
  const [servers, setServers] = useState<WgServer[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState<WizardForm>({
    routerName: '',
    ipAddress: '',
    apiPort: '8728',
    linkedTowerId: '',
    wgServerId: '',
    routerosVersion: '7',
    lanBridgeName: '',
    lanCidr: '',
    lanGateway: '',
    wanInterface: '',
    notes: '',
  });

  const [startResult, setStartResult] = useState<StartResult | null>(null);
  const [showRawScript, setShowRawScript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckOnlineResult | null>(null);

  // ── Carga de datos ───────────────────────────────────────────────

  const loadServers = useCallback(async () => {
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      setServers(await api.get('/api/wireguard/servers'));
    } catch { /* silently ignore */ }
  }, [getAuthHeaders]);

  const loadEnrollments = useCallback(async () => {
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      setEnrollments(await api.get('/api/router-enrollment'));
    } catch { /* silently ignore */ }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadServers();
    loadEnrollments();
  }, [loadServers, loadEnrollments]);

  // ── Wizard: acciones ─────────────────────────────────────────────

  const startWizard = () => {
    setForm({
      routerName: '', ipAddress: '', apiPort: '8728', linkedTowerId: '',
      wgServerId: servers[0]?.id || '', routerosVersion: '7',
      lanBridgeName: '', lanCidr: '', lanGateway: '', wanInterface: '', notes: '',
    });
    setStartResult(null);
    setCheckResult(null);
    setStep(1);
    setError('');
    setView('wizard');
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    try {
      const body = {
        routerName: form.routerName.trim(),
        ipAddress: form.ipAddress || undefined,
        apiPort: form.apiPort ? Number(form.apiPort) : undefined,
        linkedTowerId: form.linkedTowerId || undefined,
        wgServerId: form.wgServerId,
        routerosVersion: form.routerosVersion,
        lanBridgeName: form.lanBridgeName || undefined,
        lanCidr: form.lanCidr || undefined,
        lanGateway: form.lanGateway || undefined,
        wanInterface: form.wanInterface || undefined,
        notes: form.notes || undefined,
      };
      const api = createAuthorizedApi(getAuthHeaders);
      const data = await api.post<StartResult>('/api/router-enrollment/start', body);
      setStartResult(data);
      setStep(5);
      loadEnrollments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!startResult) return;
    const enrollmentId = startResult.enrollment.id;
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      // El endpoint devuelve text/plain: apiClient entrega el cuerpo como string.
      const text = await api.get<string>(`/api/router-enrollment/${enrollmentId}/download`);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = startResult.scriptFilename;
      a.click();
      URL.revokeObjectURL(url);
      loadEnrollments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al descargar');
    }
  };

  const handleCheckOnline = async () => {
    if (!startResult) return;
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const data = await api.post<CheckOnlineResult>(
        `/api/router-enrollment/${startResult.enrollment.id}/check-online`,
      );
      setCheckResult(data);
      loadEnrollments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!canRevokeEnrollment(userRole)) return;
    if (!confirm('¿Revocar este enrollment? Se revocará el peer WireGuard.')) return;
    setLoading(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.post(`/api/router-enrollment/${id}/revoke`);
      loadEnrollments();
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!canRevokeEnrollment(userRole)) return;
    if (!confirm('¿Eliminar este enrollment revocado de la lista? Esta acción no se puede deshacer.')) return;
    setLoading(true);
    setError('');
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      await api.delete(`/api/router-enrollment/${id}`);
      loadEnrollments();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el enrollment');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Renderizado: lista de enrollments ────────────────────────────

  if (view === 'list') {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wifi className="text-green-400" size={24} />
            <div>
              <h2 className="text-xl font-bold text-white">Enrollment WireGuard Auto</h2>
              <p className="text-sm text-gray-400">
                Incorpora routers MikroTik a NugaCore via WireGuard automáticamente.
              </p>
            </div>
          </div>
          {canStartEnrollment(userRole) && (
            <button
              onClick={startWizard}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              Nuevo enrollment
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-950/40 border border-red-800/50 text-red-300 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {enrollments.length === 0 ? (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-12 text-center">
            <Wifi className="mx-auto mb-4 text-gray-600" size={48} />
            <p className="text-gray-400">No hay enrollments aún.</p>
            {canStartEnrollment(userRole) && (
              <button
                onClick={startWizard}
                className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
              >
                Iniciar primer enrollment
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {enrollments.map((enr) => (
              <div
                key={enr.id}
                className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-gray-700 rounded-lg">
                    <Server size={18} className="text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium text-white">{enr.routerName || enr.routerId}</p>
                    <p className="text-xs text-gray-400">
                      {enr.id} · Peer: {enr.wgPeerId}
                    </p>
                    {enr.scriptHash && (
                      <p className="text-xs text-gray-500 font-mono">
                        hash: {enr.scriptHash.substring(0, 16)}…
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-1 rounded font-medium ${STATUS_COLORS[enr.status]}`}>
                    {enr.statusLabel}
                  </span>
                  {enr.checkOnlineAttempts > 0 && (
                    <span className="text-xs text-gray-500">{enr.checkOnlineAttempts} intentos</span>
                  )}
                  {canRevokeEnrollment(userRole) &&
                    enr.status !== 'revoked' &&
                    enr.status !== 'online' && (
                      <button
                        onClick={() => handleRevoke(enr.id)}
                        className="text-xs px-2 py-1 bg-red-900 hover:bg-red-800 text-red-300 rounded"
                      >
                        Revocar
                      </button>
                    )}
                  {canRevokeEnrollment(userRole) && enr.status === 'revoked' && (
                    <button
                      onClick={() => handleDelete(enr.id)}
                      disabled={loading}
                      title="Eliminar de la lista"
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 hover:border-rose-800/50 rounded transition-colors"
                    >
                      <Trash2 size={12} />
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Renderizado: wizard ──────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Cabecera wizard */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setView('list')}
          className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
        >
          <List size={18} className="text-gray-400" />
        </button>
        <Wifi className="text-green-400" size={22} />
        <div>
          <h2 className="text-lg font-bold text-white">Nuevo Enrollment WireGuard</h2>
          <p className="text-xs text-gray-400">Paso {step} de {STEP_LABELS.length}: {STEP_LABELS[step - 1]}</p>
        </div>
      </div>

      {/* Barra de pasos */}
      <div className="flex items-center gap-1">
        {STEP_LABELS.map((label, i) => (
          <React.Fragment key={i}>
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors
                ${i + 1 < step ? 'bg-green-900 text-green-300' : ''}
                ${i + 1 === step ? 'bg-blue-800 text-blue-200' : ''}
                ${i + 1 > step ? 'bg-gray-800 text-gray-500' : ''}
              `}
            >
              {i + 1 < step && <CheckCircle size={12} />}
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{i + 1}</span>
            </div>
            {i < STEP_LABELS.length - 1 && <ChevronRight size={12} className="text-gray-600 shrink-0" />}
          </React.Fragment>
        ))}
      </div>

      {/* Mensajes de error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── Paso 1: Datos del router ── */}
      {step === 1 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Server size={18} className="text-blue-400" />
            <h3 className="font-semibold text-white">Datos del router</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Nombre del router <span className="text-red-400">*</span>
              </label>
              <input
                value={form.routerName}
                onChange={(e) => setForm({ ...form, routerName: e.target.value })}
                placeholder="Torre Norte — MikroTik hEX"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">IP de gestión (opcional)</label>
              <input
                value={form.ipAddress}
                onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                placeholder="10.0.1.10"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Puerto API RouterOS</label>
              <input
                value={form.apiPort}
                onChange={(e) => setForm({ ...form, apiPort: e.target.value })}
                placeholder="8728"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">ID de torre (opcional)</label>
              <input
                value={form.linkedTowerId}
                onChange={(e) => setForm({ ...form, linkedTowerId: e.target.value })}
                placeholder="t-1"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1">Notas</label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Router sector norte, reemplazo de mkt-1"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={() => { if (!form.routerName.trim()) { setError('El nombre del router es obligatorio.'); return; } setError(''); setStep(2); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 2: Servidor WireGuard ── */}
      {step === 2 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={18} className="text-purple-400" />
            <h3 className="font-semibold text-white">Servidor WireGuard</h3>
          </div>
          {servers.length === 0 ? (
            <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-300 text-sm">
              No hay servidores WireGuard configurados. Crea uno en el módulo WireGuard Manager.
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((srv) => (
                <button
                  key={srv.id}
                  onClick={() => setForm({ ...form, wgServerId: srv.id })}
                  className={`w-full text-left p-4 rounded-xl border transition-colors ${
                    form.wgServerId === srv.id
                      ? 'border-purple-500 bg-purple-900/30'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-white">{srv.name}</p>
                      <p className="text-xs text-gray-400">
                        {srv.endpointHost}:{srv.endpointPort} · Pool: {srv.vpnCidr}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">{srv.peersCount} peers</p>
                      <span className={`text-xs px-2 py-0.5 rounded ${srv.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                        {srv.status}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} className="flex items-center gap-1 px-4 py-2 text-gray-400 hover:text-white text-sm">
              <ChevronLeft size={16} /> Atrás
            </button>
            <button
              onClick={() => { if (!form.wgServerId) { setError('Selecciona un servidor WireGuard.'); return; } setError(''); setStep(3); }}
              disabled={servers.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: Configuración LAN ── */}
      {step === 3 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Terminal size={18} className="text-orange-400" />
            <h3 className="font-semibold text-white">Configuración LAN <span className="text-gray-500 font-normal text-sm">(opcional)</span></h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Versión RouterOS</label>
              <select
                value={form.routerosVersion}
                onChange={(e) => setForm({ ...form, routerosVersion: e.target.value as '6' | '7' })}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="7">RouterOS v7 (recomendado)</option>
                <option value="6">RouterOS v6</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Nombre bridge LAN</label>
              <input
                value={form.lanBridgeName}
                onChange={(e) => setForm({ ...form, lanBridgeName: e.target.value })}
                placeholder="bridge-lan"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">CIDR LAN</label>
              <input
                value={form.lanCidr}
                onChange={(e) => setForm({ ...form, lanCidr: e.target.value })}
                placeholder="192.168.1.0/24"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Gateway LAN</label>
              <input
                value={form.lanGateway}
                onChange={(e) => setForm({ ...form, lanGateway: e.target.value })}
                placeholder="192.168.1.1"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Interfaz WAN</label>
              <input
                value={form.wanInterface}
                onChange={(e) => setForm({ ...form, wanInterface: e.target.value })}
                placeholder="ether1"
                className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(2)} className="flex items-center gap-1 px-4 py-2 text-gray-400 hover:text-white text-sm">
              <ChevronLeft size={16} /> Atrás
            </button>
            <button
              onClick={() => { setError(''); setStep(4); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
            >
              Siguiente <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 4: Generar script ── */}
      {step === 4 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Terminal size={18} className="text-green-400" />
            <h3 className="font-semibold text-white">Generar script de enrollment</h3>
          </div>
          <div className="p-4 bg-gray-900 rounded-lg space-y-2 text-sm">
            <div className="flex justify-between text-gray-300">
              <span className="text-gray-500">Router:</span>
              <span className="font-medium">{form.routerName}</span>
            </div>
            <div className="flex justify-between text-gray-300">
              <span className="text-gray-500">Servidor WG:</span>
              <span className="font-medium">{servers.find((s) => s.id === form.wgServerId)?.name || form.wgServerId}</span>
            </div>
            <div className="flex justify-between text-gray-300">
              <span className="text-gray-500">RouterOS:</span>
              <span className="font-medium">v{form.routerosVersion}</span>
            </div>
          </div>
          <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-300 text-xs">
            <AlertTriangle size={14} className="inline mr-1" />
            El script contendrá claves privadas WireGuard. Guárdalo de forma segura y elimínalo tras importarlo.
          </div>
          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(3)} className="flex items-center gap-1 px-4 py-2 text-gray-400 hover:text-white text-sm">
              <ChevronLeft size={16} /> Atrás
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <Terminal size={16} />}
              {loading ? 'Generando…' : 'Generar script .rsc'}
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 5: Descargar script ── */}
      {step === 5 && startResult && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Download size={18} className="text-blue-400" />
            <h3 className="font-semibold text-white">Script generado</h3>
          </div>

          <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-300 text-sm">
            <CheckCircle size={14} className="inline mr-1" />
            Script generado. Peer WG asignado: IP {startResult.wgAssignedIp}
          </div>

          <div className="p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg text-yellow-300 text-xs">
            <AlertTriangle size={14} className="inline mr-1" />
            {startResult.securityWarning}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Vista previa (claves ocultas) · {startResult.scriptFilename}
              </span>
              <button
                onClick={() => setShowRawScript(!showRawScript)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white"
              >
                {showRawScript ? <EyeOff size={12} /> : <Eye size={12} />}
                {showRawScript ? 'Ocultar' : 'Ver raw'}
              </button>
            </div>
            <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs text-green-300 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
              {showRawScript ? startResult.script : sanitizeScript(startResult.script)}
            </pre>
            <p className="text-xs text-gray-500 font-mono">Hash: {startResult.scriptHash}</p>
          </div>

          <div className="flex justify-between pt-2">
            <div />
            <div className="flex gap-2">
              <button
                onClick={() => copyToClipboard(startResult.script)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
              >
                {copied ? <CheckCircle size={16} className="text-green-400" /> : <Copy size={16} />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
              >
                <Download size={16} />
                Descargar .rsc
              </button>
              <button
                onClick={() => setStep(6)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
              >
                Siguiente <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Paso 6: Instrucciones de importación ── */}
      {step === 6 && startResult && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Terminal size={18} className="text-orange-400" />
            <h3 className="font-semibold text-white">Importar en el MikroTik</h3>
          </div>

          <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-lg text-rose-200 text-xs">
            <AlertTriangle size={14} className="inline mr-1" />
            <strong>No pegues</strong> el script completo en Terminal. Pegar corrompe la
            <code className="mx-1 font-mono">private-key</code>
            WireGuard (<em>failure: invalid private key</em>). Usa siempre
            <strong className="mx-1">Descargar .rsc</strong> + <code className="font-mono">/import</code>.
          </div>

          <div className="space-y-3 text-sm text-gray-300">
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-700 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <p className="font-medium">Conecta al MikroTik por Winbox o SSH</p>
                <p className="text-gray-500 text-xs">Usa la red local, cable Ethernet o acceso físico al equipo.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-700 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <p className="font-medium">Haz un backup previo (recomendado)</p>
                <pre className="mt-1 bg-gray-900 px-3 py-1.5 rounded text-xs font-mono text-green-300">
                  /system backup save name=pre-nugacore-enrollment
                </pre>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-700 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <p className="font-medium">Descarga el .rsc y súbelo al router (Files / drag &amp; drop en Winbox)</p>
                <p className="text-gray-500 text-xs">Archivo: <span className="font-mono text-blue-300">{startResult.scriptFilename}</span></p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-700 text-white rounded-full flex items-center justify-center text-xs font-bold">4</span>
              <div>
                <p className="font-medium">Importa el archivo (no pegar líneas)</p>
                <pre className="mt-1 bg-gray-900 px-3 py-1.5 rounded text-xs font-mono text-green-300">
                  /import file-name={startResult.scriptFilename}
                </pre>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-blue-700 text-white rounded-full flex items-center justify-center text-xs font-bold">5</span>
              <div>
                <p className="font-medium">El script configura WireGuard automáticamente</p>
                <p className="text-gray-500 text-xs">
                  Crea la interfaz NugaCoreWG · Asigna la IP {startResult.wgAssignedIp} · Configura el peer hacia el servidor WG · Agrega ruta de gestión.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-6 h-6 bg-green-700 text-white rounded-full flex items-center justify-center text-xs font-bold">6</span>
              <div>
                <p className="font-medium">Elimina el archivo del router</p>
                <pre className="mt-1 bg-gray-900 px-3 py-1.5 rounded text-xs font-mono text-green-300">
                  /file remove [find name~"^(nc-|nugacore-)"]
                </pre>
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(5)} className="flex items-center gap-1 px-4 py-2 text-gray-400 hover:text-white text-sm">
              <ChevronLeft size={16} /> Atrás
            </button>
            <button
              onClick={() => setStep(7)}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
            >
              Ya importé el script <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 7: Confirmar online ── */}
      {step === 7 && startResult && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Wifi size={18} className="text-green-400" />
            <h3 className="font-semibold text-white">Confirmar router online</h3>
          </div>

          <p className="text-sm text-gray-400">
            NugaCore intentará conectarse al router via WireGuard y leerá su estado en modo read-only.
          </p>

          {checkResult && (
            <div className={`p-3 rounded-lg border text-sm ${
              checkResult.isOnline
                ? 'bg-green-900/30 border-green-700 text-green-300'
                : 'bg-yellow-900/30 border-yellow-700 text-yellow-300'
            }`}>
              {checkResult.isOnline ? <CheckCircle size={14} className="inline mr-1" /> : <Clock size={14} className="inline mr-1" />}
              {checkResult.message}
              {checkResult.snapshotSource && (
                <span className="ml-2 text-xs opacity-75">(fuente: {checkResult.snapshotSource})</span>
              )}
            </div>
          )}

          {checkResult?.enrollment.status === 'failed' && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              <XCircle size={14} className="inline mr-1" />
              {checkResult.enrollment.failureReason}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(6)} className="flex items-center gap-1 px-4 py-2 text-gray-400 hover:text-white text-sm">
              <ChevronLeft size={16} /> Atrás
            </button>
            <div className="flex gap-2">
              {checkResult?.isOnline ? (
                <button
                  onClick={() => { loadEnrollments(); setView('list'); }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                >
                  <CheckCircle size={16} />
                  Finalizar enrollment
                </button>
              ) : (
                <button
                  onClick={handleCheckOnline}
                  disabled={loading || checkResult?.enrollment.status === 'failed'}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
                >
                  {loading ? <RefreshCw size={16} className="animate-spin" /> : <Wifi size={16} />}
                  {loading ? 'Verificando…' : 'Verificar online'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
