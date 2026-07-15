import React from 'react';
import UserMenu from './UserMenu';
import { UserSessionProfile } from '../lib/supabase';

interface IsolatedAppShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  profile: UserSessionProfile;
  onLogout: () => void;
}

/**
 * Shell mínimo para los scopes aislados (portal / tech-pwa).
 * Solo muestra logo+título a la izquierda y UserMenu a la derecha.
 * No incluye Sidebar, menús WISP ni ningún otro chrome de admin.
 */
export default function IsolatedAppShell({
  title,
  subtitle,
  children,
  profile,
  onLogout,
}: IsolatedAppShellProps) {
  return (
    <div
      id="isolated-app-shell"
      className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-x-hidden selection:bg-indigo-500/30 selection:text-white"
    >
      {/* Minimal top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 py-2.5 px-4 md:px-6 bg-slate-950 border-b border-slate-900 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
          <div className="min-w-0">
            <span className="font-bold text-sm text-white tracking-wide truncate block">{title}</span>
            {subtitle && (
              <span className="text-[10px] text-slate-500 font-mono truncate block">{subtitle}</span>
            )}
          </div>
        </div>
        <UserMenu profile={profile} onLogout={onLogout} />
      </header>

      {/* Module content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
