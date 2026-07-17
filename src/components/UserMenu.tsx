import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, User, LogOut, X, BadgeCheck, ShieldCheck, IdCard } from 'lucide-react';
import { UserSessionProfile } from '../lib/supabase';
import { getAllowedTabsByRole, getModuleLabel } from '../lib/rbac';

interface UserMenuProps {
  profile: UserSessionProfile;
  onLogout: () => void;
}

const roleBadgeClass = (role: UserSessionProfile['role']): string => {
  switch (role) {
    case 'Super Admin': return 'bg-indigo-950 text-indigo-400 border border-indigo-900';
    case 'Administrador': return 'bg-sky-950 text-sky-400 border border-sky-900';
    case 'Cobranza': return 'bg-emerald-950 text-emerald-400 border border-emerald-900';
    case 'Técnico': return 'bg-amber-950 text-amber-400 border border-amber-900';
    case 'Soporte': return 'bg-blue-950 text-blue-400 border border-blue-900';
    default: return 'bg-slate-900 text-slate-400 border border-slate-800';
  }
};

const initials = (p: UserSessionProfile): string =>
  (p.full_name || p.email || 'NN').trim().substring(0, 2).toUpperCase();

export default function UserMenu({ profile, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProfileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [profileOpen]);

  const modules = getAllowedTabsByRole(profile.role);

  const profileModal = profileOpen && typeof document !== 'undefined'
    ? createPortal(
      (
        <div
          id="user-profile-modal-overlay"
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/85 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setProfileOpen(false)}
          role="presentation"
        >
          <div
            id="user-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-profile-modal-title"
            className="w-full sm:max-w-md max-h-[92dvh] sm:max-h-[90vh] bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden font-sans flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 sm:px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
              <h3 id="user-profile-modal-title" className="text-sm font-bold text-white flex items-center space-x-2">
                <IdCard className="w-4 h-4 text-indigo-400" />
                <span>Perfil del operador</span>
              </h3>
              <button
                type="button"
                id="user-profile-modal-close"
                onClick={() => setProfileOpen(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-850 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto min-h-0">
              <div className="flex items-center space-x-3">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.full_name} className="w-12 h-12 rounded-xl object-cover border border-slate-800 shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <span className="w-12 h-12 rounded-xl bg-indigo-950 border border-indigo-900 text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                    {initials(profile)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{profile.full_name}</p>
                  <p className="text-[11px] text-slate-500 font-mono truncate">{profile.email}</p>
                  <span className={`inline-flex mt-1 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${roleBadgeClass(profile.role)}`}>{profile.role}</span>
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-2 text-[11px] font-mono">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                  <dt className="text-slate-500 shrink-0">User ID</dt>
                  <dd className="text-slate-300 break-all sm:truncate sm:max-w-[220px] sm:text-right">{profile.id}</dd>
                </div>
                <div className="flex items-center justify-between gap-2 bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                  <dt className="text-slate-500 shrink-0">Origen de auth</dt>
                  <dd className="text-slate-300 flex items-center space-x-1 min-w-0">
                    {profile.source === 'supabase-jwt' && <BadgeCheck className="w-3 h-3 text-emerald-400 shrink-0" />}
                    <span className="truncate">{profile.source || 'desconocido'}</span>
                  </dd>
                </div>
              </dl>

              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 font-mono mb-1.5">Módulos visibles ({modules.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {modules.map((m) => (
                    <span key={m} className="text-[10px] bg-slate-950/70 border border-slate-800 text-slate-300 rounded px-1.5 py-0.5">{getModuleLabel(m)}</span>
                  ))}
                </div>
              </div>

              {profile.permissions && profile.permissions.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 font-mono mb-1.5">Permisos ({profile.permissions.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.permissions.map((p) => (
                      <span key={p} className="text-[10px] bg-indigo-950/40 border border-indigo-900/60 text-indigo-300 rounded px-1.5 py-0.5 font-mono">{p}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 sm:px-6 py-4 border-t border-slate-800 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between sm:items-center shrink-0">
              <span className="text-[10px] text-slate-600 font-mono text-center sm:text-left">NugaCore · sesión activa</span>
              <button
                type="button"
                id="user-profile-modal-logout"
                onClick={() => { setProfileOpen(false); onLogout(); }}
                className="flex items-center justify-center space-x-1.5 text-xs text-rose-400 hover:text-rose-300 border border-slate-800 hover:border-rose-900/50 rounded-lg px-3 py-2 sm:py-1.5 transition font-semibold w-full sm:w-auto"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          </div>
        </div>
      ),
      document.body,
    )
    : null;

  return (
    <div className="relative" ref={ref}>
      {/* Chip de usuario */}
      <button
        type="button"
        id="user-menu-chip"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center space-x-2.5 pl-1.5 pr-2.5 py-1.5 rounded-xl border border-slate-800 bg-slate-900/70 hover:bg-slate-900 hover:border-slate-700 transition"
        title="Cuenta y perfil"
      >
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt={profile.full_name} className="w-7 h-7 rounded-lg object-cover border border-slate-800" referrerPolicy="no-referrer" />
        ) : (
          <span className="w-7 h-7 rounded-lg bg-indigo-950 border border-indigo-900 text-indigo-400 flex items-center justify-center font-bold text-[10px]">
            {initials(profile)}
          </span>
        )}
        <span className="hidden sm:flex flex-col items-start leading-tight">
          <span className="text-[11px] font-bold text-slate-200 truncate max-w-[140px]">{profile.full_name}</span>
          <span className={`text-[8px] font-mono font-bold px-1 rounded ${roleBadgeClass(profile.role)}`}>{profile.role}</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden font-sans">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-xs font-bold text-slate-200 truncate">{profile.full_name}</p>
            <p className="text-[10px] text-slate-500 font-mono truncate">{profile.email}</p>
          </div>
          <button
            type="button"
            onClick={() => { setProfileOpen(true); setOpen(false); }}
            className="w-full flex items-center space-x-2.5 px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-850 hover:text-white transition text-left"
          >
            <User className="w-3.5 h-3.5 text-slate-500" />
            <span>Ver perfil</span>
          </button>
          <button
            type="button"
            onClick={() => { setProfileOpen(true); setOpen(false); }}
            className="w-full flex items-center space-x-2.5 px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-850 hover:text-white transition text-left"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
            <span>Mi sesión</span>
          </button>
          <button
            type="button"
            id="user-menu-logout"
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full flex items-center space-x-2.5 px-4 py-2.5 text-xs text-rose-400 hover:bg-rose-950/30 transition text-left border-t border-slate-800"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      )}

      {profileModal}
    </div>
  );
}
