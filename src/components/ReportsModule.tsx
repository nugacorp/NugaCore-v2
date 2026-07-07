import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { fetchWithRateLimitBackoff } from '../lib/apiBackoff';

interface ReportsModuleProps {
  getAuthHeaders: () => Promise<Record<string, string>>;
}

const CATALOG = [
  { id: 'revenue', scope: 'financial', label: 'Ingresos y cobranza', description: 'Facturación, cobrado y cartera' },
  { id: 'clients', scope: 'operational', label: 'Clientes activos/suspendidos', description: 'Estado de servicio por zona' },
  { id: 'tickets', scope: 'operational', label: 'Tickets y SLA', description: 'Causas, técnicos, vencidos' },
  { id: 'security', scope: 'security', label: 'Auditoría de accesos', description: 'Eventos de seguridad' },
];

export default function ReportsModule({ getAuthHeaders }: ReportsModuleProps) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff('/api/reports/summary', { headers });
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => { void load(); }, [load]);

  const exportReport = async (scope: string, format: 'csv' | 'xlsx' | 'pdf') => {
    const headers = await getAuthHeaders();
    const res = await fetchWithRateLimitBackoff(`/api/reports/export?scope=${scope}&format=${format}`, { headers });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nugacore-${scope}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-indigo-400" /> Centro de Reportes
          </h2>
          <p className="text-slate-400 text-sm">Exportación CSV, XLSX y PDF</p>
        </div>
        <button type="button" onClick={() => void load()} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(summary.counts ?? {}).map(([k, v]) => (
            <div key={k} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-2xl font-bold text-white">{String(v)}</div>
              <div className="text-xs text-slate-400 uppercase">{k}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {CATALOG.map((r) => (
          <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h3 className="text-white font-semibold">{r.label}</h3>
            <p className="text-slate-400 text-sm mt-1 mb-4">{r.description}</p>
            <div className="flex flex-wrap gap-2">
              {(['csv', 'xlsx', 'pdf'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => void exportReport(r.scope, fmt)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 text-xs border border-indigo-500/30"
                >
                  <Download className="w-3 h-3" /> {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
