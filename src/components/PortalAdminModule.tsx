import React, { useCallback, useEffect, useState } from 'react';
import {
  Globe,
  Save,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Link2,
  Settings2,
} from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';
import {
  DEFAULT_PORTAL_FEATURES,
  PORTAL_FEATURE_LABELS,
  PORTAL_FEATURE_ORDER,
  type PortalConfigResponse,
  type PortalFeatures,
} from '../lib/portalConfig';
import { buildPortalShareUrl } from '../lib/portalLinks';

interface PortalAdminModuleProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

export default function PortalAdminModule({ getAuthHeaders }: PortalAdminModuleProps) {
  const [features, setFeatures] = useState<PortalFeatures>(DEFAULT_PORTAL_FEATURES);
  const [savedFeatures, setSavedFeatures] = useState<PortalFeatures>(DEFAULT_PORTAL_FEATURES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff('/api/portal/config', { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `No se pudo cargar la configuración (${res.status})`);
      }
      const data = (await res.json()) as PortalConfigResponse;
      const next = { ...DEFAULT_PORTAL_FEATURES, ...data.features };
      setFeatures(next);
      setSavedFeatures(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = PORTAL_FEATURE_ORDER.some((key) => features[key] !== savedFeatures[key]);

  const toggleFeature = (key: keyof PortalFeatures) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
    setSuccess('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff('/api/portal/config', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ features }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `No se pudo guardar (${res.status})`);
      }
      const data = (await res.json()) as PortalConfigResponse;
      const next = { ...DEFAULT_PORTAL_FEATURES, ...data.features };
      setFeatures(next);
      setSavedFeatures(next);
      setSuccess('Configuración del portal guardada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const portalPreviewUrl = (() => {
    try {
      return `${window.location.origin}/?app=portal`;
    } catch {
      return '/?app=portal';
    }
  })();

  const techPreviewUrl = (() => {
    try {
      return `${window.location.origin}/?app=tech`;
    } catch {
      return '/?app=tech';
    }
  })();

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-sky-500/15 border border-sky-500/25 p-2.5">
            <Settings2 className="w-6 h-6 text-sky-300" />
          </div>
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-sky-400/90">Apps</p>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">Portal del Cliente</h1>
            <p className="text-sm text-slate-400 mt-1">
              Elige qué verá el abonado en su portal. Los cambios aplican a todo tu WISP.
            </p>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 md:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Funciones visibles en el portal</h2>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 font-mono">Cargando configuración…</p>
        ) : (
          <ul className="space-y-2">
            {PORTAL_FEATURE_ORDER.map((key) => {
              const meta = PORTAL_FEATURE_LABELS[key];
              const checked = features[key];
              return (
                <li key={key}>
                  <label
                    htmlFor={`portal-feature-${key}`}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${
                      checked
                        ? 'border-sky-500/30 bg-sky-950/25'
                        : 'border-slate-800 bg-slate-900/30 hover:border-slate-700'
                    }`}
                  >
                    <input
                      id={`portal-feature-${key}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFeature(key)}
                      className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-sky-500 focus:ring-sky-500/40"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">{meta.title}</span>
                      <span className="block text-xs text-slate-400 mt-0.5">{meta.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-800/50 bg-rose-950/40 px-3 py-2.5 text-sm text-rose-200">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="w-4 h-4" />
            {success}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            id="portal-admin-save"
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || !dirty}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 md:p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Link2 className="w-4 h-4 text-slate-400" />
          Enlaces de las apps
        </h2>
        <p className="text-xs text-slate-400">
          Comparte el enlace del portal desde la ficha del cliente en CRM. La app del técnico abre en modo aislado.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider font-mono text-slate-500 mb-1">App del Cliente</p>
            <code className="text-[11px] text-sky-300 break-all">{portalPreviewUrl}&amp;client=&lt;id&gt;</code>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wider font-mono text-slate-500 mb-1 flex items-center gap-1">
              <Smartphone className="w-3 h-3" /> App del Técnico
            </p>
            <code className="text-[11px] text-emerald-300 break-all">{techPreviewUrl}</code>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 font-mono">
          Ejemplo portal: {buildPortalShareUrl(typeof window !== 'undefined' ? window.location.origin : '', 'cliente-id')}
        </p>
      </section>
    </div>
  );
}
