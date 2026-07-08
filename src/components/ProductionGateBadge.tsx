import React from 'react';
import { useProductionGates } from '../lib/useProductionGates';

type GateKey =
  | 'liveMode'
  | 'mikrotikWorkerLive'
  | 'mikrotikWorkerCommit'
  | 'notificationsLive'
  | 'automationExecute'
  | 'provisioningExecute'
  | 'paymentsRouterLive'
  | 'safeCommandQueueLive'
  | 'serviceStatusLive';

interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
  gate?: GateKey;
  label?: string;
}

export default function ProductionGateBadge({ getAuthHeaders, gate = 'liveMode', label }: Props) {
  const { gates } = useProductionGates(getAuthHeaders);
  const live = gates[gate];

  if (live) {
    return (
      <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
        {label ?? 'LIVE'}
      </span>
    );
  }

  return (
    <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200">
      {label ?? 'DRY RUN'}
    </span>
  );
}
