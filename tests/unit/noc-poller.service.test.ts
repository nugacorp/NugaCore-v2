import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetNocPollerForTests,
  getNocPollerStatus,
  isNocPollerEnabled,
  runPollCycle,
} from '../../backend/domains/noc-poller/service';
import { store } from '../../backend/state/store';

describe('noc-poller', () => {
  afterEach(() => _resetNocPollerForTests());

  it('está deshabilitado por defecto', () => {
    expect(isNocPollerEnabled()).toBe(false);
    expect(getNocPollerStatus().enabled).toBe(false);
  });

  it('runPollCycle actualiza lastHealthCheckAt en routers del store', async () => {
    const routerId = store.MIKROTIK_ROUTERS[0]?.id;
    expect(routerId).toBeTruthy();

    const before = store.MIKROTIK_ROUTERS[0].lastHealthCheckAt;
    const cycle = await runPollCycle();

    expect(cycle.routersPolled).toBeGreaterThan(0);
    expect(cycle.results.every((r) => r.sampledAt)).toBe(true);
    expect(getNocPollerStatus().lastCycle?.cycleId).toBe(cycle.cycleId);

    const after = store.MIKROTIK_ROUTERS.find((r) => r.id === routerId)?.lastHealthCheckAt;
    expect(after).not.toBe(before);
  });
});
