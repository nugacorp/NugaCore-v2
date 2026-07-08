// ====================================================================
// NOC Poller — fundación de polling READ-ONLY (sin Redis/Influx).
//
// Actualiza el estado de salud de routers en el store en memoria de forma
// periódica. No ejecuta escritura en RouterOS. Gated por NOC_POLLER_ENABLED.
// ====================================================================

export interface NocPollRouterResult {
  routerId: string;
  routerName: string;
  source: 'live' | 'simulated';
  isOnline: boolean;
  cpuUsagePct: number;
  memoryUsagePct: number;
  sampledAt: string;
  note?: string;
}

export interface NocPollCycleResult {
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  pollerEnabled: boolean;
  liveReads: boolean;
  routersPolled: number;
  results: NocPollRouterResult[];
}

export interface NocPollerStatus {
  enabled: boolean;
  intervalMs: number;
  liveReads: boolean;
  lastCycle: NocPollCycleResult | null;
}
