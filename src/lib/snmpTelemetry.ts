// ====================================================================
// Telemetría SNMP — tipos y helper de presentación compartidos.
//
// Modelo tenant-scoped que devuelve GET /api/snmp/telemetry (cada WISP solo
// ve sus propios routers). Compartido entre la vista NOC (NocTelemetryModule)
// y el inventario de routers (InventoryRoutersModule) para que un nuevo
// `source` del backend no deje uniones locales stale en silencio.
// ====================================================================

export type SnmpSource = 'snmp-live' | 'simulated' | 'disabled' | 'pending';

export interface SnmpTelemetryRouterView {
  routerId: string;
  name: string;
  source: SnmpSource;
  isReachable: boolean;
  /** true si la última muestra es live y suficientemente reciente. */
  fresh: boolean;
  sysName?: string;
  sysUpTime?: string;
  latencyMs?: number;
  sampledAt?: string;
  note?: string;
}

export interface SnmpTelemetryResponse {
  enabled: boolean;
  intervalMs: number;
  generatedAt: string;
  total: number;
  routers: SnmpTelemetryRouterView[];
}

export interface SnmpBadge {
  label: string;
  className: string;
}

/**
 * Badge de estado SNMP por router. `undefined` (fila sin telemetría, p. ej.
 * router sin community en el inventario) devuelve el estado "sin SNMP"; la
 * vista NOC siempre pasa un router definido.
 */
export const snmpBadge = (r?: SnmpTelemetryRouterView): SnmpBadge => {
  if (!r) return { label: 'sin SNMP', className: 'bg-slate-800 text-slate-500 border-slate-700' };
  if (r.source === 'snmp-live' && r.fresh) {
    return { label: 'En vivo', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' };
  }
  if (r.source === 'snmp-live') {
    return { label: 'Desactualizada', className: 'bg-amber-500/15 text-amber-400 border-amber-500/20' };
  }
  if (r.source === 'pending') {
    return { label: 'Sin muestra', className: 'bg-slate-700/40 text-slate-400 border-slate-600/30' };
  }
  if (r.source === 'disabled') {
    return { label: 'Poller off', className: 'bg-slate-700/40 text-slate-400 border-slate-600/30' };
  }
  return { label: 'Sin respuesta', className: 'bg-rose-500/15 text-rose-400 border-rose-500/20' };
};
