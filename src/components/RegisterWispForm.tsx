import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Building2, CheckCircle2, ChevronLeft, Mail, User } from 'lucide-react';
import { getErrorMessage } from '../lib/errors';
import { clientLog } from '../lib/clientLog';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { messageForAuthEmailError } from '../lib/authEmailErrors';

interface RegisterWispFormProps {
  onBack?: () => void;
  onGoLogin?: () => void;
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export default function RegisterWispForm({ onBack, onGoLogin }: RegisterWispFormProps) {
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [awaitingEmail, setAwaitingEmail] = useState(false);

  const previewSlug = useMemo(
    () => (slugTouched ? slug : slugify(companyName)),
    [companyName, slug, slugTouched],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setOk('');
    setLoading(true);
    try {
      const res = await fetch('/api/wisp-onboarding/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          slug: previewSlug,
          email,
          password,
          fullName,
          city: city || undefined,
          phone: phone || undefined,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof body.code === 'string' ? body.code : '';
        if (code === 'EMAIL_EXISTS' || body.error === 'EMAIL_EXISTS') {
          throw new Error('Ese correo ya está registrado. Inicia sesión o usa otro.');
        }
        if (code === 'REGISTRATION_DISABLED') {
          throw new Error(
            'El registro público de WISP no está habilitado en este entorno. Contacta al administrador.',
          );
        }
        if (code === 'RATE_LIMITED' || res.status === 429) {
          throw new Error('Demasiados intentos. Espera un minuto e intenta de nuevo.');
        }
        throw new Error(
          typeof body.error === 'string' && body.error
            ? body.error
            : 'No se pudo registrar el WISP',
        );
      }

      setAwaitingEmail(true);
      if (body.emailConfirmationRequired) {
        setOk(
          body.confirmationEmailSent
            ? `Te enviamos un correo a ${email}. Confirma el enlace para activar tu cuenta e inicia sesión.`
            : `Cuenta creada para ${email}. El correo no se pudo enviar automáticamente; usa «Reenviar confirmación» abajo.`,
        );
      } else {
        setOk(body.note || 'WISP creado. Ya puedes iniciar sesión.');
      }
    } catch (err) {
      clientLog.error(err);
      setError(getErrorMessage(err, 'Error al registrar el WISP'));
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    setError('');
    const target = email.trim().toLowerCase();
    if (!target) {
      setError('No hay correo para reenviar la confirmación.');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError('Auth no está configurada en este entorno.');
      return;
    }
    setResending(true);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: target,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (resendErr) throw resendErr;
      setOk(`Reenviamos el correo de confirmación a ${target}. Revisa bandeja y spam.`);
    } catch (err) {
      clientLog.error(err);
      setError(messageForAuthEmailError(err, 'No se pudo reenviar la confirmación.'));
    } finally {
      setResending(false);
    }
  };

  return (
    <div id="nugacore-register-wisp" className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-200 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, #34d399 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      <div className="absolute top-10 right-1/4 w-[360px] h-[360px] bg-emerald-600/10 rounded-full blur-[110px] pointer-events-none" />

      <div className="w-full max-w-lg bg-slate-900/95 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative z-10">
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between text-[11px] text-slate-400">
          <span>Nuevo WISP · cuenta aislada</span>
          {onBack && (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 hover:text-slate-200">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver
            </button>
          )}
        </div>

        {awaitingEmail ? (
          <div className="p-8 space-y-5 text-center">
            <div className="inline-flex p-3 rounded-2xl bg-slate-950 border border-slate-800 text-emerald-400">
              <Mail className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-black text-white">Confirma tu correo</h1>
            {ok && (
              <div className="p-3 bg-emerald-950/70 border border-emerald-900 rounded-xl text-xs text-emerald-200 flex gap-2 text-left">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}
              </div>
            )}
            {error && (
              <div className="p-3 bg-rose-950/70 border border-rose-900 rounded-xl text-xs text-rose-200 flex gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}
            <p className="text-xs text-slate-400 leading-relaxed">
              Sin confirmar el correo no podrás iniciar sesión. Revisa spam si no lo ves en unos minutos.
            </p>
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                id="register-resend-confirmation"
                disabled={resending || loading}
                onClick={() => void handleResendConfirmation()}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm py-3.5 rounded-xl disabled:opacity-50 shadow-lg shadow-emerald-950/40"
              >
                {resending ? 'Reenviando…' : 'Reenviar confirmación'}
              </button>
              <p className="text-[11px] text-slate-500">
                Si ves «rate limit», espera unos minutos: Supabase limita cuántos correos se pueden enviar.
              </p>
              {onGoLogin && (
                <button
                  type="button"
                  onClick={onGoLogin}
                  className="w-full border border-slate-700 hover:border-sky-600/50 hover:bg-slate-950 text-sky-300 font-semibold text-sm py-3 rounded-xl"
                >
                  Ya confirmé · Ir a iniciar sesión
                </button>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-8 space-y-4">
            <div className="text-center space-y-2 mb-2">
              <div className="inline-flex p-3 rounded-2xl bg-slate-950 border border-slate-800 text-emerald-400">
                <Building2 className="w-7 h-7" />
              </div>
              <h1 className="text-xl font-black text-white">Registrar mi WISP</h1>
              <p className="text-xs text-slate-400">
                Crea tu organización. Te enviaremos un correo para confirmar la cuenta.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-rose-950/70 border border-rose-900 rounded-xl text-xs text-rose-200 flex gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <label className="block space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Nombre comercial</span>
              <input
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
                placeholder="Ej. Red Norte Internet"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Identificador (slug)</span>
              <input
                required
                value={previewSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white font-mono"
                placeholder="red-norte"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Tu nombre</span>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white"
                  />
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Ciudad</span>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Correo del administrador</span>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white"
                />
              </div>
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Contraseña (mín. 8)</span>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400">Teléfono (opcional)</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? 'Creando cuenta…' : 'Crear WISP'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>

            {onGoLogin && (
              <p className="text-center text-xs text-slate-500">
                ¿Ya tienes cuenta?{' '}
                <button type="button" onClick={onGoLogin} className="text-sky-400 font-semibold">
                  Iniciar sesión
                </button>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
