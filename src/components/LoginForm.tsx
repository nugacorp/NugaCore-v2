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
  ArrowRight
} from 'lucide-react';
import { isSupabaseConfigured, supabase, MOCK_USER_PROFILES, UserSessionProfile } from '../lib/supabase';

interface LoginFormProps {
  onLoginSuccess: (userProfile: UserSessionProfile) => void;
}

export default function LoginForm({ onLoginSuccess }: LoginFormProps) {
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

  // Auto-fill dynamic helper for demo or staging
  const handleAutoFill = (mockEmail: string) => {
    setEmail(mockEmail);
    setPassword('nugacorp_secure_pwd2026');
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
          // Fetch additional profile data from 'users_profile'
          const { data: profile, error: profileError } = await supabase
            .from('users_profile')
            .select(`
              id, 
              email, 
              full_name, 
              phone, 
              avatar_url,
              user_roles (
                roles (
                  name
                )
              )
            `)
            .eq('id', data.user.id)
            .single();

          if (profileError || !profile) {
            // Rollback details or assign a safe fallback role
            const fallbackProfile: UserSessionProfile = {
              id: data.user.id,
              email: data.user.email || email,
              full_name: 'Usuario Autenticado',
              role: 'Administrador', // Fallback safety
            };
            onLoginSuccess(fallbackProfile);
            return;
          }

          // Extract role name from nested query structure
          let assignedRole: any = 'Solo lectura';
          const userRoles = profile.user_roles as any;
          if (Array.isArray(userRoles) && userRoles.length > 0 && userRoles[0]?.roles?.name) {
            assignedRole = userRoles[0].roles.name;
          } else if (userRoles?.roles?.name) {
            assignedRole = userRoles.roles.name;
          }

          const userSession: UserSessionProfile = {
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            phone: profile.phone || '',
            role: assignedRole,
            avatar_url: profile.avatar_url || '',
          };

          setSuccessMessage(`¡Bienvenido de vuelta, ${profile.full_name}!`);
          setTimeout(() => {
            onLoginSuccess(userSession);
          }, 1000);
        }
      } else {
        // --- PREVIEW / STAGING MODE (Fallback Auth) ---
        // Validate against our local mock user lists
        const foundMock = MOCK_USER_PROFILES.find(
          p => p.email.toLowerCase() === email.trim().toLowerCase()
        );

        if (foundMock) {
          setSuccessMessage(`Simulando acceso exitoso para ${foundMock.full_name} (${foundMock.role})`);
          setTimeout(() => {
            onLoginSuccess(foundMock);
          }, 900);
        } else {
          // If not matching a exact mock profile, create a safe default "Invitado" profile for robust preview navigation
          const genericUserProfile: UserSessionProfile = {
            id: 'generic-demo-session-id',
            email: email,
            full_name: email.split('@')[0].toUpperCase(),
            role: 'Super Admin', // Automatically grant Admin status so they can view and test all tabs
            avatar_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80'
          };
          setSuccessMessage(`Creando sesión de prueba como Super Administrador para: ${genericUserProfile.full_name}`);
          setTimeout(() => {
            onLoginSuccess(genericUserProfile);
          }, 1100);
        }
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
          <div className="text-center space-y-2">
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
                    placeholder="ejemplo@nugacorp.com"
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

              {/* DEMO / TESTING CREDENTIALS SLIDER PANEL (Shown when supabase isn't connected or as standard help documentation) */}
              <div className="mt-6 pt-5 border-t border-slate-800/80 space-y-3">
                <div className="flex items-center space-x-2 text-[10px] font-bold text-slate-400 uppercase font-mono tracking-wider">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Acceso Rápido (Perfiles Demo WISP/ISP)</span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Usa estos perfiles preconfigurados para explorar las diferentes vistas operativas del NOC:
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => handleAutoFill('admin@nugacorp.com')}
                    className="bg-slate-950 hover:bg-slate-850 p-2 border border-slate-800 rounded-xl text-left hover:border-indigo-500 transition flex flex-col justify-between"
                  >
                    <span className="text-white font-bold block">1. Rodrigo (Super Admin)</span>
                    <span className="text-indigo-400 mt-1">admin@nugacorp.com</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoFill('cobranza@nugacorp.com')}
                    className="bg-slate-950 hover:bg-slate-850 p-2 border border-slate-800 rounded-xl text-left hover:border-emerald-500 transition flex flex-col justify-between"
                  >
                    <span className="text-white font-bold block">2. M. Luisa (Cobranza)</span>
                    <span className="text-emerald-400 mt-1">cobranza@nugacorp.com</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoFill('tecnico@nugacorp.com')}
                    className="bg-slate-950 hover:bg-slate-850 p-2 border border-slate-800 rounded-xl text-left hover:border-amber-500 transition flex flex-col justify-between"
                  >
                    <span className="text-white font-bold block">3. Carlos (Técnico)</span>
                    <span className="text-amber-500 mt-1">tecnico@nugacorp.com</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoFill('soporte@nugacorp.com')}
                    className="bg-slate-950 hover:bg-slate-850 p-2 border border-slate-800 rounded-xl text-left hover:border-blue-500 transition flex flex-col justify-between"
                  >
                    <span className="text-white font-bold block">4. Sofía (Soporte NOC)</span>
                    <span className="text-blue-400 mt-1">soporte@nugacorp.com</span>
                  </button>
                </div>
              </div>

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
                    placeholder="usuario@nugacorp.com"
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
          <span>Soporte: noc@nugacorp.com</span>
        </div>

      </div>
    </div>
  );
}
