import { useCallback, useEffect, useState } from 'react';
import { fetchWithRateLimitBackoff } from './apiBackoff';

export type ProductionGates = {
  liveMode: boolean;
  mikrotikWorkerLive: boolean;
  mikrotikWorkerCommit: boolean;
  notificationsLive: boolean;
  automationExecute: boolean;
  provisioningExecute: boolean;
  paymentsRouterLive: boolean;
  safeCommandQueueLive: boolean;
  serviceStatusLive: boolean;
};

const DEFAULT_GATES: ProductionGates = {
  liveMode: false,
  mikrotikWorkerLive: false,
  mikrotikWorkerCommit: false,
  notificationsLive: false,
  automationExecute: false,
  provisioningExecute: false,
  paymentsRouterLive: false,
  safeCommandQueueLive: false,
  serviceStatusLive: false,
};

export function useProductionGates(getAuthHeaders: () => Promise<Record<string, string>>) {
  const [gates, setGates] = useState<ProductionGates>(DEFAULT_GATES);

  const refresh = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetchWithRateLimitBackoff('/api/system/production-gates', { headers });
      if (!res.ok) return;
      const data = await res.json();
      setGates({ ...DEFAULT_GATES, ...(data.gates ?? {}) });
    } catch {
      setGates(DEFAULT_GATES);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { gates, refresh, isDryRun: !gates.liveMode };
}
