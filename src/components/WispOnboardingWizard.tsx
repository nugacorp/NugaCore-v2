import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  MapPin,
  Router,
} from 'lucide-react';
import { getErrorMessage } from '../lib/errors';

type Step = 'company' | 'zone' | 'billing' | 'router' | 'done';

interface OnboardingState {
  currentStep?: Step;
  companyName?: string;
  city?: string;
  contactPhone?: string;
  zoneName?: string;
  billingCycleDay?: number;
  billingCycleTime?: string;
  firstRouterName?: string;
  completedSteps?: string[];
}

interface WispOnboardingWizardProps {
  getAuthHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  tenantId?: string;
  companyHint?: string;
  onCompleted: () => void;
}

const ALL_STEPS: { id: Step; title: string; blurb: string; icon: React.ReactNode }[] = [
  { id: 'company', title: 'Tu WISP', blurb: 'Datos de la empresa (del registro).', icon: <Building2 className="w-4 h-4" /> },
  { id: 'zone', title: 'Primera zona', blurb: 'Define tu primera zona de cobertura.', icon: <MapPin className="w-4 h-4" /> },
  { id: 'billing', title: 'Día de corte', blurb: 'Fecha y hora de corte de facturación.', icon: <CalendarClock className="w-4 h-4" /> },
  { id: 'router', title: 'Primer router', blurb: 'Registra el nombre de tu primer router.', icon: <Router className="w-4 h-4" /> },
];

export default function WispOnboardingWizard({
  getAuthHeaders,
  tenantId,
  companyHint,
  onCompleted,
}: WispOnboardingWizardProps) {
  const [step, setStep] = useState<Step>('zone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [companyName, setCompanyName] = useState(companyHint || '');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [billingDay, setBillingDay] = useState(1);
  const [billingTime, setBillingTime] = useState('08:00');
  const [routerName, setRouterName] = useState('');
  const [companyAlreadySet, setCompanyAlreadySet] = useState(Boolean(companyHint?.trim()));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await Promise.resolve(getAuthHeaders());
        const res = await fetch('/api/wisp-onboarding/status', { headers });
        if (!res.ok) return;
        const data = await res.json();
        const state = data.state as OnboardingState | null;
        if (cancelled || !state) return;
        if (state.companyName) setCompanyName(state.companyName);
        if (state.city) setCity(state.city);
        if (state.contactPhone) setPhone(state.contactPhone);
        if (state.zoneName) setZoneName(state.zoneName);
        if (state.billingCycleDay) setBillingDay(state.billingCycleDay);
        if (state.billingCycleTime) setBillingTime(String(state.billingCycleTime).slice(0, 5));
        if (state.firstRouterName) setRouterName(state.firstRouterName);
        const hasCompany = Boolean(state.companyName?.trim())
          || Boolean(state.completedSteps?.includes('company'));
        setCompanyAlreadySet(hasCompany);
        // Registro ya guardó empresa → no volver a pedir nombre/ciudad/teléfono.
        const next = state.currentStep && state.currentStep !== 'done'
          ? (state.currentStep === 'company' && hasCompany ? 'zone' : state.currentStep)
          : (hasCompany ? 'zone' : 'company');
        setStep(next);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  const STEPS = companyAlreadySet
    ? ALL_STEPS.filter((s) => s.id !== 'company')
    : ALL_STEPS;

  const putStep = async (path: string, body: Record<string, unknown>) => {
    setLoading(true);
    setError('');
    try {
      const headers = await Promise.resolve(getAuthHeaders());
      const res = await fetch(path, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar el paso');
      return data as OnboardingState;
    } catch (err) {
      setError(getErrorMessage(err, 'Error al guardar'));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const goNext = async () => {
    try {
      if (step === 'company') {
        await putStep('/api/wisp-onboarding/steps/company', {
          companyName, city, contactPhone: phone,
        });
        setStep('zone');
        return;
      }
      if (step === 'zone') {
        await putStep('/api/wisp-onboarding/steps/zone', { zoneName });
        setStep('billing');
        return;
      }
      if (step === 'billing') {
        await putStep('/api/wisp-onboarding/steps/billing', {
          billingCycleDay: billingDay,
          billingCycleTime: billingTime,
        });
        setStep('router');
        return;
      }
      if (step === 'router') {
        await putStep('/api/wisp-onboarding/steps/router', { routerName });
        setLoading(true);
        const headers = await Promise.resolve(getAuthHeaders());
        const res = await fetch('/api/wisp-onboarding/complete', {
          method: 'POST',
          headers,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo completar el onboarding');
        setStep('done');
        onCompleted();
      }
    } catch {
      /* error already set */
    } finally {
      setLoading(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div id="nugacore-wisp-onboarding" className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'radial-gradient(circle, #38bdf8 1px, transparent 1px)', backgroundSize: '26px 26px' }} />
      <div className="w-full max-w-2xl relative z-10 space-y-6">
        <div className="text-center space-y-2">
          <p className="text-[11px] uppercase tracking-widest text-emerald-400 font-bold">Onboarding obligatorio</p>
          <h1 className="text-2xl sm:text-3xl font-black text-white">Configura tu WISP</h1>
          <p className="text-sm text-slate-400">
            Completa estos pasos antes de entrar a la consola.
            {tenantId ? <span className="block text-[11px] font-mono text-slate-500 mt-1">Tenant: {tenantId}</span> : null}
          </p>
        </div>

        <div className={`grid gap-2 ${STEPS.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`rounded-xl border px-2 py-2 text-center ${
                i <= stepIndex
                  ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200'
                  : 'border-slate-800 bg-slate-900/50 text-slate-500'
              }`}
            >
              <div className="flex justify-center mb-1">{s.icon}</div>
              <div className="text-[10px] font-bold">{s.title}</div>
            </div>
          ))}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-5 shadow-xl">
          {error && (
            <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-900 rounded-xl p-3">{error}</div>
          )}

          {step === 'company' && (
            <div className="space-y-3">
              <h2 className="font-bold text-white">Datos de tu empresa</h2>
              <p className="text-xs text-slate-400">Este nombre identifica tu WISP dentro de NugaCore.</p>
              <input className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm" placeholder="Nombre comercial" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <input className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm" placeholder="Ciudad" value={city} onChange={(e) => setCity(e.target.value)} />
                <input className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm" placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}

          {step === 'zone' && (
            <div className="space-y-3">
              <h2 className="font-bold text-white">Primera zona de cobertura</h2>
              {companyAlreadySet && companyName ? (
                <p className="text-xs text-slate-400">
                  Empresa guardada: <span className="text-slate-200 font-medium">{companyName}</span>
                  {city ? <> · {city}</> : null}
                  {phone ? <> · {phone}</> : null}
                </p>
              ) : null}
              <p className="text-xs text-slate-400">
                Crea tu primera zona (torre / sector). Más adelante puedes añadir más desde Red.
              </p>
              <input className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm" placeholder="Ej. Zona Centro" value={zoneName} onChange={(e) => setZoneName(e.target.value)} />
            </div>
          )}

          {step === 'billing' && (
            <div className="space-y-3">
              <h2 className="font-bold text-white">Día y hora de corte</h2>
              <p className="text-xs text-slate-400">
                Define cuándo se genera el ciclo de facturación / cortes por mora en esta zona.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs text-slate-400">
                  Día del mes (1–31)
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
                    value={billingDay}
                    onChange={(e) => setBillingDay(Number(e.target.value))}
                  />
                </label>
                <label className="space-y-1 text-xs text-slate-400">
                  Hora
                  <input
                    type="time"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
                    value={billingTime}
                    onChange={(e) => setBillingTime(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {step === 'router' && (
            <div className="space-y-3">
              <h2 className="font-bold text-white">Primer router</h2>
              <p className="text-xs text-slate-400">
                Indica el nombre del router principal. Después podrás enrolarlo por WireGuard desde Inventario → Routers
                (el host WG aplica peers de todos los WISP en un solo túnel de plataforma, con datos aislados por tenant).
              </p>
              <input className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm" placeholder="Ej. CHR-Core-01" value={routerName} onChange={(e) => setRouterName(e.target.value)} />
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void goNext()}
            className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Guardando…' : step === 'router' ? 'Finalizar y abrir consola' : 'Continuar'}
            {!loading && (step === 'router' ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />)}
          </button>
        </div>
      </div>
    </div>
  );
}
