import React, { useEffect, useRef, useState } from 'react';
import { Bell, AlertTriangle, CheckCheck, Radio } from 'lucide-react';
import type { NocAlert } from '../types';

interface TopAlertsBellProps {
  alerts: NocAlert[];
  onAcknowledgeAll: () => void | Promise<void>;
  onOpenNoc?: () => void;
}

const severityClass = (severity: NocAlert['severity']): string => {
  switch (severity) {
    case 'critical':
      return 'text-rose-400 bg-rose-950/50 border-rose-900/60';
    case 'warning':
      return 'text-amber-300 bg-amber-950/40 border-amber-900/50';
    default:
      return 'text-sky-300 bg-sky-950/40 border-sky-900/50';
  }
};

function formatWhen(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TopAlertsBell({ alerts, onAcknowledgeAll, onOpenNoc }: TopAlertsBellProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unacked = alerts.filter((a) => !a.acknowledged);
  const count = unacked.length;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        id="top-alerts-bell"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-xl border border-slate-800 bg-slate-900/70 text-slate-300 hover:text-white hover:bg-slate-900 hover:border-slate-700 transition"
        title="Alertas operativas"
        aria-label={count > 0 ? `${count} alertas sin revisar` : 'Alertas operativas'}
        aria-expanded={open}
      >
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          id="top-alerts-panel"
          className="absolute left-0 md:left-auto md:right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-slate-100">Alertas operativas</p>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                NOC, red y sistema · inbox del operador
              </p>
            </div>
            {count > 0 && (
              <span className="text-[10px] font-mono font-bold text-rose-300 bg-rose-950/50 border border-rose-900/50 px-1.5 py-0.5 rounded">
                {count} activas
              </span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {unacked.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-500 text-xs">
                <CheckCheck className="w-5 h-5 mx-auto mb-2 text-emerald-500/70" />
                Sin alertas pendientes
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {unacked.slice(0, 12).map((alert) => (
                  <li key={alert.id} className="px-4 py-3 hover:bg-slate-950/60 transition">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-lg border ${severityClass(alert.severity)}`}
                      >
                        {alert.severity === 'critical' ? (
                          <AlertTriangle className="w-3 h-3" />
                        ) : (
                          <Radio className="w-3 h-3" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-bold text-slate-100 truncate">{alert.source}</p>
                          <span className="text-[9px] font-mono text-slate-500 shrink-0 uppercase">
                            {alert.severity}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{alert.message}</p>
                        <p className="text-[9px] font-mono text-slate-600 mt-1">{formatWhen(alert.timestamp)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-3 py-2.5 border-t border-slate-800 flex items-center gap-2 bg-slate-950/40">
            {onOpenNoc && (
              <button
                type="button"
                id="btn-top-alerts-open-noc"
                onClick={() => {
                  setOpen(false);
                  onOpenNoc();
                }}
                className="flex-1 text-[11px] font-semibold text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 py-1.5 transition"
              >
                Ir a NOC
              </button>
            )}
            <button
              type="button"
              id="btn-top-alerts-ack-all"
              disabled={count === 0}
              onClick={async () => {
                await onAcknowledgeAll();
                setOpen(false);
              }}
              className="flex-1 text-[11px] font-semibold text-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-950/50 hover:bg-indigo-900/50 border border-indigo-900/50 rounded-lg px-2.5 py-1.5 transition"
            >
              Marcar leídas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
