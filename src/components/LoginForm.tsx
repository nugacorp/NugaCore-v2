import React, { useState } from 'react';
import { 
  Lock, 
  Mail, 
  Cpu, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  CheckCircle2, 
  Sparkles, 
  HelpCircle,
  Database,
  ArrowRight,
  ChevronLeft
} from 'lucide-react';
import { isSupabaseConfigured, supabase, STAGING_QUICK_LOGINS, isQuickLoginEnabled, UserSessionProfile } from '../lib/supabase';
import { fetchProfileFromBackend } from '../lib/authSession';

interface LoginFormProps {
  onLoginSuccess: (userProfile: UserSessionProfile, accessToken?: string) => void;
  onBack?: () => void;
}

export default function LoginForm({ onLoginSuccess, onBack }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Recovery Mode state
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryStatus, setRecoveryStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Quick-login helper (staging): SOLO prerellena el email. Nunca rellena el
  // password — el operador debe teclear la contraseña real (Supabase auth).
  const handleAutoFill = (stagingEmail: string) => {
    setEmail(stagingEmail);
    setPassword('');
    setErrorMessage('');
  };

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
        // --- REAL SUPABASE AUTHENTICATION ---
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (error) {
          throw new Error(error.message);
        }

        if (data?.user) {
          // El rol/perfil CANÓNICO viene del backend (/api/auth/me, service-role),
          // NO de una consulta directa a users_profile (bloqueada por RLS deny-by-default).
          const accessToken = data.session?.access_token || '';
          const backendProfile = accessToken ? await fetchProfileFromBackend(accessToken) : null;

          const userSession: UserSessionProfile = backendProfile || {
            id: data.user.id,
            email: data.user.email || email,
            full_name: 'Usuario Autenticado',
            role: 'Solo lectura',
          };

          setSuccessMessage(`¡Bienvenido de vuelta, ${userSession.full_name}!`);
          setTimeout(() => {
            onLoginSuccess(userSession, accessToken);
          }, 800);
        }
      } else {
        // --- BACKEND DE AUTENTICACIÓN NO CONFIGURADO ---
        // Hardening 4.3.1: se eliminó el login-sin-password de modo preview.
        // Sin Supabase configurado no hay forma segura de autenticar.
        setErrorMessage(
          'El backend de autenticación no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
          'No es posible iniciar sesión en este entorno.'
        );
      }
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || 'Error en las credenciales proporcionadas.');
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
        // Real Supabase Password Reset Flow
        const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) throw error;
        setRecoveryStatus({
          type: 'success',
          message: 'Se ha enviado un enlace real de restablecimiento a tu dirección de correo.'
        });
      } else {
        // Simulation Flow
        setRecoveryStatus({
          type: 'success',
          message: `[Simulación] Correo enviado a ${recoveryEmail}. En un ambiente real con Supabase Auth configurado, este botón enviará las instrucciones de recuperación.`
        });
      }
    } catch (err: any) {
      console.error(err);
      setRecoveryStatus({ type: 'error', message: err.message || 'Error al enviar correo de recuperación.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="nugacore-login" className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-200 relative overflow-hidden">
      
      {/* Background Matrix Accents */}
      <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "radial-gradient(circle, #4f46e5 1px, transparent 1px)", backgroundSize: "32px 32px" }}></div>
      <div className="absolute top-1/4 left-1/4 w-[350px] h-[350px] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative z-10">
        
        {/* Dynamic upper banner indicating mode */}
        <div className={`px-5 py-2.5 text-[11px] font-mono flex items-center justify-between border-b ${
          isSupabaseConfigured 
            ? 'bg-indigo-950/40 border-indigo-900 text-indigo-400' 
            : 'bg-emerald-950/40 border-emerald-900 text-emerald-400'
        }`}>
          <div className="flex items-center space-x-2">
            <span className={`w-2 h-2 rounded-full ${isSupabaseConfigured ? 'bg-indigo-500 animate-pulse' : 'bg-emerald-400'}`}></span>
            <span>{isSupabaseConfigured ? 'Conexión Real Supabase Activa' : 'Modo Simulador de Pruebas'}</span>
          </div>
          <span className="text-slate-500 font-bold uppercase text-[9px]">v2.4 LTS</span>
        </div>

        {/* Content Box */}
        <div className="p-8 sm:p-10 space-y-6">
          
          {/* Logo & Brand */}
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
            <div className="inline-flex items-center justify-center p-3 bg-indigo-950 text-indigo-400 rounded-2xl border border-indigo-900/50 mb-2">
              <Cpu className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">NugaCore ERP</h1>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              Plataforma Centralizada de Telecomunicaciones y Control Financiero para <span className="text-slate-200 font-bold">NugaCorp</span>.
            </p>
          </div>

          {!isRecoveryMode ? (
            // --- LOGIN FORM ---
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              
              {errorMessage && (
                <div className="p-3.5 bg-rose-950/80 border border-rose-850/60 rounded-2xl flex items-start space-x-2.5 text-xs text-rose-200">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <span className="leading-snug">{errorMessage}</span>
                </div>
              )}

              {successMessage && (
                <div className="p-3.5 bg-emerald-950/80 border border-emerald-850/60 rounded-2xl flex items-start space-x-2.5 text-xs text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="leading-snug font-mono">{successMessage}</span>
                </div>
              )}

              {/* Email Entry */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block font-mono">
                  Correo del Operador
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="operador@example.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-4 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Password Entry */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block font-mono">
                    Contraseña de Acceso
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsRecoveryMode(true)}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 hover:underline transition font-mono"
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
                    placeholder="••••••••••••••"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-11 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Action */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white py-3.5 rounded-xl font-bold text-xs transition duration-150 flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                <span>{loading ? 'Validando Credenciales...' : 'Iniciar Sesión en NugaCore'}</span>
                {!loading && <ArrowRight className="w-3.5 h-3.5" />}
              </button>

              {/* QUICK LOGIN (solo staging, gateado). Prerellena el email del
                  usuario de staging; el password se teclea manualmente. No se
                  muestra en producción (VITE_ENABLE_QUICK_LOGIN apagado). */}
              {isQuickLoginEnabled && (
                <div className="mt-6 pt-5 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center space-x-2 text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Acceso Rápido Staging (solo email)</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Prerellena el correo del usuario de staging. Escribe tu contraseña para iniciar sesión.
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    {STAGING_QUICK_LOGINS.map((entry) => (
                      <button
                        key={entry.email}
                        type="button"
                        onClick={() => handleAutoFill(entry.email)}
                        className="bg-slate-950 hover:bg-slate-850 p-2 border border-slate-800 rounded-xl text-left hover:border-indigo-500 transition flex flex-col justify-between"
                      >
                        <span className="text-white font-bold block">{entry.label}</span>
                        <span className="text-indigo-400 mt-1 truncate">{entry.email}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

            </form>
          ) : (
            // --- RECOVERY PASSWORD WINDOW ---
            <form onSubmit={handlePasswordResetSubmit} className="space-y-4">
              <h3 className="text-sm font-bold text-white font-mono text-center border-b border-slate-800 pb-2">
                Restablecer Contraseña
              </h3>
              
              <p className="text-xs text-slate-400 leading-relaxed">
                Ingresa la dirección de correo electrónico registrada para enviarte un enlace de recuperación.
              </p>

              {recoveryStatus && (
                <div className={`p-3.5 border rounded-2xl flex items-start space-x-2 text-xs font-mono ${
                  recoveryStatus.type === 'success' 
                    ? 'bg-emerald-950/80 border-emerald-850 text-emerald-300' 
                    : 'bg-rose-950/80 border-rose-850 text-rose-200'
                }`}>
                  {recoveryStatus.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <span>{recoveryStatus.message}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block font-mono">
                  Tu Correo Registrado
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <Mail className="w-4 h-4" />
                  </span>
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="usuario@example.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-4 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Recovery Actions */}
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
                  className="w-2/3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-3 rounded-xl transition"
                >
                  {loading ? 'Enviando...' : 'Enviar Correo'}
                </button>
              </div>

            </form>
          )}

        </div>

        {/* Footer brand info */}
        <div className="px-8 py-4 bg-slate-950 border-t border-slate-800 text-center flex items-center justify-between text-[10px] font-mono text-slate-500">
          <span>NugaCore ERP NOC System</span>
          <span>Soporte: noc@example.com</span>
        </div>

      </div>
    </div>
  );
}
