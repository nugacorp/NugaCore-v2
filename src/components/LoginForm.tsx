import React, { useState } from 'react';
import { getErrorMessage } from '../lib/errors';
import { clientLog } from '../lib/clientLog';
import {
  Lock,
  Mail,
  Cpu,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ChevronLeft,
} from 'lucide-react';
import { isSupabaseConfigured, supabase, UserSessionProfile } from '../lib/supabase';
import { fetchProfileFromBackend } from '../lib/authSession';

interface LoginFormProps {
  onLoginSuccess: (userProfile: UserSessionProfile, accessToken?: string) => void;
  onBack?: () => void;
  onGoRegister?: () => void;
}

export default function LoginForm({ onLoginSuccess, onBack, onGoRegister }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!email || !password) {
      setErrorMessage('Por favor ingresa tu correo y contraseña.');
      return;
    }

    setLoading(true);

    try {
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (error) {
          const msg = error.message || '';
          if (/email not confirmed/i.test(msg)) {
            throw new Error(
              'Debes confirmar tu correo antes de entrar. Revisa tu bandeja o usa «Reenviar confirmación».',
            );
          }
          if (/invalid login credentials/i.test(msg)) {
            throw new Error('Correo o contraseña incorrectos.');
          }
          throw new Error(msg);
        }

        if (data?.user) {
          const accessToken = data.session?.access_token || '';
          const backendProfile = accessToken ? await fetchProfileFromBackend(accessToken) : null;
          if (!backendProfile || !accessToken) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
            throw new Error(
              'No se pudo validar la sesión con el servidor. Cierra la pestaña, vuelve a entrar e intenta de nuevo.',
            );
          }

          setSuccessMessage(`¡Bienvenido, ${backendProfile.full_name}!`);
          setTimeout(() => {
            onLoginSuccess(backendProfile, accessToken);
          }, 600);
        }
      } else {
        setErrorMessage(
          'El backend de autenticación no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). '
          + 'No es posible iniciar sesión en este entorno.',
        );
      }
    } catch (err) {
      clientLog.error(err);
      setErrorMessage(getErrorMessage(err, 'Error en las credenciales proporcionadas.'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryStatus(null);

    if (!recoveryEmail) {
      setRecoveryStatus({ type: 'error', message: 'Ingresa una dirección de correo válida.' });
      return;
    }

    setLoading(true);

    try {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) throw error;
        setRecoveryStatus({
          type: 'success',
          message: 'Si el correo existe, recibirás un enlace para restablecer la contraseña.',
        });
      } else {
        setRecoveryStatus({
          type: 'error',
          message: 'Auth no está configurada; no se puede enviar recuperación.',
        });
      }
    } catch (err) {
      clientLog.error(err);
      setRecoveryStatus({ type: 'error', message: getErrorMessage(err, 'Error al enviar correo de recuperación.') });
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    const target = (email || recoveryEmail).trim();
    if (!target) {
      setErrorMessage('Ingresa tu correo para reenviar la confirmación.');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setErrorMessage('Auth no está configurada en este entorno.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: target,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setSuccessMessage(`Si la cuenta existe y falta confirmar, enviamos un correo a ${target}.`);
    } catch (err) {
      clientLog.error(err);
      setErrorMessage(getErrorMessage(err, 'No se pudo reenviar la confirmación.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="nugacore-login" className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-200 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, #38bdf8 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      <div className="absolute -top-24 left-1/4 w-[420px] h-[420px] bg-sky-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/5 w-[380px] h-[380px] bg-emerald-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative z-10 backdrop-blur-sm">
        <div className="px-6 py-3 text-[11px] font-mono flex items-center justify-between border-b border-slate-800 bg-slate-950/80 text-slate-400">
          <div className="flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${isSupabaseConfigured ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span>{isSupabaseConfigured ? 'Acceso seguro' : 'Auth no configurada'}</span>
          </div>
          <span className="text-slate-600 font-bold uppercase text-[9px]">NugaCore</span>
        </div>

        <div className="p-8 sm:p-10 space-y-7">
          <div className="text-center space-y-2 relative">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="absolute left-0 top-0 text-xs text-slate-500 hover:text-slate-300 flex items-center space-x-1.5 transition-colors font-mono py-1 px-2.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950/60"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Volver</span>
              </button>
            )}
            <div className="inline-flex items-center justify-center p-3 bg-slate-950 text-sky-400 rounded-2xl border border-slate-800 mb-1">
              <Cpu className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">NugaCore</h1>
            <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
              Consola WISP / FTTH. Inicia sesión con las credenciales de tu operador.
            </p>
          </div>

          {!isRecoveryMode ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              {errorMessage && (
                <div className="p-3.5 bg-rose-950/80 border border-rose-900/60 rounded-2xl flex items-start space-x-2.5 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span className="leading-snug">{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3.5 bg-emerald-950/80 border border-emerald-900/60 rounded-2xl flex items-start space-x-2.5 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{successMessage}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                  Correo del operador
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operador@tuwisp.com"
                    required
                    autoComplete="username"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                    Contraseña
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsRecoveryMode(true)}
                    className="text-[10px] text-sky-400 hover:text-sky-300 hover:underline transition"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <Lock className="w-4 h-4" />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-11 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white py-3.5 rounded-xl font-bold text-sm transition duration-150 flex items-center justify-center space-x-2 shadow-lg shadow-sky-900/30 disabled:opacity-50"
              >
                <span>{loading ? 'Validando…' : 'Iniciar sesión'}</span>
                {!loading && <ArrowRight className="w-3.5 h-3.5" />}
              </button>

              <p className="text-center text-[11px] text-slate-500 pt-1">
                ¿No llegó el correo de alta?{' '}
                <button
                  type="button"
                  onClick={() => void handleResendConfirmation()}
                  className="text-sky-400 hover:text-sky-300 font-semibold"
                  disabled={loading}
                >
                  Reenviar confirmación
                </button>
              </p>

              {onGoRegister && (
                <p className="text-center text-xs text-slate-500 pt-2">
                  ¿Nuevo WISP?{' '}
                  <button
                    type="button"
                    onClick={onGoRegister}
                    className="text-emerald-400 hover:text-emerald-300 font-semibold"
                  >
                    Crear cuenta
                  </button>
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
              <h3 className="text-sm font-bold text-white text-center border-b border-slate-800 pb-2">
                Restablecer contraseña
              </h3>

              <p className="text-xs text-slate-400 leading-relaxed">
                Te enviaremos un enlace de recuperación al correo registrado.
              </p>

              {recoveryStatus && (
                <div className={`p-3.5 border rounded-2xl flex items-start space-x-2 text-xs ${
                  recoveryStatus.type === 'success'
                    ? 'bg-emerald-950/80 border-emerald-900 text-emerald-300'
                    : 'bg-rose-950/80 border-rose-900 text-rose-200'
                }`}
                >
                  {recoveryStatus.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{recoveryStatus.message}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                  Correo registrado
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="usuario@tuwisp.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecoveryMode(false);
                    setRecoveryStatus(null);
                  }}
                  className="w-1/3 bg-slate-950 hover:bg-slate-850 text-slate-400 text-xs font-semibold py-3 rounded-xl transition"
                >
                  Volver
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-2/3 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold py-3 rounded-xl transition"
                >
                  {loading ? 'Enviando…' : 'Enviar enlace'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="px-8 py-4 bg-slate-950 border-t border-slate-800 text-center text-[10px] text-slate-500">
          Cada WISP opera con datos aislados en la misma plataforma.
        </div>
      </div>
    </div>
  );
}
