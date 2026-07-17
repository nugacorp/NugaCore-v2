import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, Eye, EyeOff, Lock } from 'lucide-react';
import { getErrorMessage } from '../lib/errors';
import { clientLog } from '../lib/clientLog';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

interface ResetPasswordFormProps {
  onDone: () => void;
  onCancel?: () => void;
}

export default function ResetPasswordForm({ onDone, onCancel }: ResetPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setOk('');

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError('Auth no está configurada en este entorno.');
      return;
    }

    setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setOk('Contraseña actualizada. Ya puedes usar la consola.');
      setTimeout(() => onDone(), 700);
    } catch (err) {
      clientLog.error(err);
      setError(getErrorMessage(err, 'No se pudo actualizar la contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="nugacore-reset-password" className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-200 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, #38bdf8 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      <div className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl relative z-10">
        <div className="px-6 py-3 border-b border-slate-800 bg-slate-950/80 text-[11px] text-slate-400 flex justify-between">
          <span>Nueva contraseña</span>
          <span className="uppercase text-[9px] text-slate-600 font-bold">NugaCore</span>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 rounded-2xl bg-slate-950 border border-slate-800 text-sky-400">
              <Cpu className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-black text-white">Restablecer contraseña</h1>
            <p className="text-xs text-slate-400">Elige una contraseña nueva para tu cuenta de operador.</p>
          </div>

          {error && (
            <div className="p-3 bg-rose-950/70 border border-rose-900 rounded-xl text-xs text-rose-200 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {ok && (
            <div className="p-3 bg-emerald-950/70 border border-emerald-900 rounded-xl text-xs text-emerald-200 flex gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {ok}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Nueva contraseña</span>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 pl-11 pr-11 text-sm text-white"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500"
                aria-label={showPassword ? 'Ocultar' : 'Mostrar'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Confirmar</span>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 text-sm text-white"
              autoComplete="new-password"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm py-3.5 rounded-xl disabled:opacity-50"
          >
            {loading ? 'Guardando…' : 'Guardar contraseña'}
          </button>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full text-xs text-slate-500 hover:text-slate-300"
            >
              Cancelar
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
