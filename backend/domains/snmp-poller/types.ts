// ====================================================================
// SNMP Poller — tipos (lectura UDP 161, gated por SNMP_POLLER_ENABLED).
// ====================================================================

export type SnmpPollSource = 'snmp-live' | 'simulated' | 'disabled';

export interface SnmpTarget {
  id: string;
  routerId: string;
  name: string;
  host: string;
  port: number;
  community: string;
  version: '2c';
  zoneId?: string;
}

export interface OidSnapshot {
  oid: string;
  label: string;
  value: string;
}

export interface SnmpPollResult {
  targetId: string;
  routerId: string;
  name: string;
  source: SnmpPollSource;
  isReachable: boolean;
  sysName?: string;
  sysUpTime?: string;
  oids: OidSnapshot[];
  sampledAt: string;
  latencyMs?: number;
  note?: string;
}

export interface SnmpPollCycleResult {
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  pollerEnabled: boolean;
  targetsPolled: number;
  results: SnmpPollResult[];
}

export interface SnmpPollerStatus {
  enabled: boolean;
  intervalMs: number;
  lastCycle: SnmpPollCycleResult | null;
}
