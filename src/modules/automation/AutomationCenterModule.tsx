import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthorizedApi } from '../../lib/apiClient';
import { Brain, ClipboardList, ListChecks, PlayCircle, RefreshCw, Workflow, Zap } from 'lucide-react';
import type { UserRole } from '../../lib/supabase';
import { canSimulateAutomation } from '../../lib/automationRbac';

// ====================================================================
// Automation Center (PROD-8) — el cerebro de NugaCore en modo DRY RUN.
//
// El motor de automatizacion UNICAMENTE toma decisiones. No ejecuta
// acciones reales, no toca routers, no cambia estados. Esta UI es de
// lectura + simulacion descriptiva.
// ====================================================================

type AutomationEvent =
  | 'CLIENT_CREATED' | 'CUSTOMER_UPDATED' | 'PAYMENT_REGISTERED' | 'INVOICE_OVERDUE'
  | 'PLAN_CHANGED' | 'SERVICE_CANCELLED' | 'INSTALLATION_COMPLETED' | 'ROUTER_REGISTERED'
  | 'IP_ASSIGNED' | 'NOC_ALERT' | 'TICKET_CREATED' | 'TICKET_CLOSED'
  | 'INVENTORY_RESERVED' | 'INVENTORY_RELEASED' | 'PROVISIONING_APPROVED' | 'PROVISIONING_REJECTED';

interface RuleView {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  event: AutomationEvent;
  decision: string;
  description: string;
}

interface PreviewStep { id: string; description: string; }

interface DecisionRecord {
  id: string;
  event: AutomationEvent;
  customerId?: string;
  decision: string;
  ruleName: string;
  source: string;
  priority: number;
  executionPreview: PreviewStep[];
  status: string;
  createdAt: string;
  dryRun: true;
}

interface SimulationResult {
  event: AutomationEvent;
  customerId?: string;
  rulesEvaluated: number;
  rulesMatched: RuleView[];
  decisions: DecisionRecord[];
  executionPreview: PreviewStep[];
  dryRun: true;
}

interface Summary {
  totalRules: number;
  enabledRules: number;
  supportedEvents: number;
  supportedDecisions: number;
  pendingDecisions: number;
  simulationsRun: number;
  dryRun: true;
}

interface Props {
  userRole: UserRole;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

type Screen = 'resumen' | 'eventos' | 'reglas' | 'decisiones' | 'preview';

const SCREENS: { id: Screen; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'eventos', label: 'Eventos' },
  { id: 'reglas', label: 'Reglas' },
  { id: 'decisiones', label: 'Decisiones simuladas' },
  { id: 'preview', label: 'Execution Preview' },
];

export default function AutomationCenterModule({ userRole, getAuthHeaders }: Props) {
  const [screen, setScreen] = useState<Screen>('resumen');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rules, setRules] = useState<RuleView[]>([]);
  const [events, setEvents] = useState<AutomationEvent[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const [simEvent, setSimEvent] = useState<AutomationEvent>('INVOICE_OVERDUE');
  const [simCustomer, setSimCustomer] = useState('');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const canSimulate = canSimulateAutomation(userRole);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const [s, r, e, d] = await Promise.all([
        api.get<typeof summary>('/api/automation/summary'),
        api.get<typeof rules>('/api/automation/rules'),
        api.get<typeof events>('/api/automation/events'),
        api.get<typeof decisions>('/api/automation/decisions'),
      ]);
      setSummary(s);
      setRules(r);
      setEvents(e);
      setDecisions(d);
      setNotice('');
    } catch {
      setNotice('No se pudo cargar el Automation Center.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const runSimulation = async () => {
    if (!canSimulate) {
      setNotice('Tu rol tiene acceso de lectura al Automation Center.');
      return;
    }
    try {
      const api = createAuthorizedApi(getAuthHeaders);
      const result = await api.post<SimulationResult>('/api/automation/simulate', {
        event: simEvent,
        customerId: simCustomer || undefined,
        payload: {},
      });
      setSimResult(result);
      setScreen('preview');
      setNotice('');
      void load();
    } catch {
      setNotice('No se pudo correr la simulacion.');
    }
  };

  const lastPreview = useMemo<PreviewStep[]>(
    () => simResult?.executionPreview ?? decisions[0]?.executionPreview ?? [],
    [simResult, decisions],
  );

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-slate-100">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-800 pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-400" />
            <h2 className="text-2xl font-bold tracking-tight text-white">Automation Center</h2>
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">DRY RUN</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">El cerebro de NugaCore: decide que deberia hacerse, sin tocar nada real.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {/* Banner obligatorio (FASE I) */}
      <div className="mb-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-xs text-indigo-200">
        El motor de automatización únicamente toma decisiones. No ejecuta acciones reales.
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">{notice}</div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {SCREENS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScreen(s.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              screen === s.id
                ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {screen === 'resumen' && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            { label: 'Reglas', value: summary?.totalRules ?? 0, icon: ListChecks },
            { label: 'Reglas activas', value: summary?.enabledRules ?? 0, icon: Zap },
            { label: 'Eventos', value: summary?.supportedEvents ?? 0, icon: Workflow },
            { label: 'Decisiones', value: summary?.supportedDecisions ?? 0, icon: Brain },
            { label: 'Cola Automation', value: summary?.pendingDecisions ?? 0, icon: ClipboardList },
            { label: 'Simulaciones', value: summary?.simulationsRun ?? 0, icon: PlayCircle },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <kpi.icon className="mb-2 h-4 w-4 text-indigo-400" />
              <div className="text-2xl font-bold text-white">{kpi.value}</div>
              <div className="text-[11px] uppercase tracking-widest text-slate-500">{kpi.label}</div>
            </div>
          ))}
        </section>
      )}

      {screen === 'eventos' && (
        <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <h3 className="mb-3 text-sm font-bold text-white">Eventos soportados</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {events.map((ev) => (
              <div key={ev} className="rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-2 font-mono text-[11px] text-slate-300">{ev}</div>
            ))}
          </div>

          {canSimulate && (
            <div className="mt-5 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <h4 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Simular evento (dry-run)</h4>
              <div className="flex flex-col gap-2 md:flex-row md:items-end">
                <label className="flex-1 text-[11px] text-slate-400">
                  Evento
                  <select
                    value={simEvent}
                    onChange={(ev) => setSimEvent(ev.target.value as AutomationEvent)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  >
                    {events.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                  </select>
                </label>
                <label className="flex-1 text-[11px] text-slate-400">
                  Cliente (opcional)
                  <input
                    value={simCustomer}
                    onChange={(ev) => setSimCustomer(ev.target.value)}
                    placeholder="cust-123"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
                  />
                </label>
                <button
                  type="button"
                  onClick={runSimulation}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  Simular
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {screen === 'reglas' && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Regla</th>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">Decisión</th>
                <th className="px-4 py-3">Prioridad</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {rules.length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={5}>No hay reglas.</td></tr>
              ) : rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-900/70">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-200">{rule.name}</div>
                    <div className="text-[11px] text-slate-500">{rule.description}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300">{rule.event}</td>
                  <td className="px-4 py-3 font-mono text-indigo-300">{rule.decision}</td>
                  <td className="px-4 py-3 text-slate-400">{rule.priority}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${rule.enabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>
                      {rule.enabled ? 'ACTIVA' : 'INACTIVA'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {screen === 'decisiones' && (
        <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 text-[10px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Decisión</th>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Origen</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {decisions.length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={6}>No hay decisiones simuladas.</td></tr>
              ) : decisions.map((d) => (
                <tr key={d.id} className="hover:bg-slate-900/70">
                  <td className="px-4 py-3 font-mono text-indigo-300">{d.decision}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">{d.event}</td>
                  <td className="px-4 py-3 text-slate-300">{d.customerId || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{d.source}</td>
                  <td className="px-4 py-3"><span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">{d.status}</span></td>
                  <td className="px-4 py-3 font-mono text-slate-500">{new Date(d.createdAt).toLocaleString('es-MX')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {screen === 'preview' && (
        <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Workflow className="h-4 w-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">Execution Preview</h3>
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">DRY RUN</span>
          </div>
          {simResult && (
            <p className="mb-3 text-[11px] text-slate-400">
              Evento <span className="font-mono text-slate-200">{simResult.event}</span> · {simResult.rulesMatched.length} regla(s) coincidente(s) · {simResult.decisions.length} decisión(es) propuesta(s).
            </p>
          )}
          {lastPreview.length === 0 ? (
            <div className="rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-8 text-center text-xs text-slate-500">
              Corre una simulación para ver el plan descriptivo.
            </div>
          ) : (
            <ol className="space-y-2">
              {lastPreview.map((step, index) => (
                <li key={step.id} className="flex items-start gap-2 rounded-lg border border-slate-900 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
                  <span className="mt-0.5 font-mono text-[10px] text-indigo-400">{index + 1}.</span>
                  <span>{step.description}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-[11px] text-slate-500">Todo el plan es descriptivo. Nunca se ejecuta automáticamente.</p>
        </section>
      )}
    </div>
  );
}
