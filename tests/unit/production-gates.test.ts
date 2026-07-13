import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('production-gates', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.NUGACORE_LIVE_MODE;
    delete process.env.MIKROTIK_WORKER_COMMIT;
    delete process.env.NOTIFICATIONS_LIVE;
  });

  it('defaults all gates to false', async () => {
    const mod = await import('../../backend/config/production-gates');
    expect(mod.productionGates.liveMode()).toBe(false);
    expect(mod.productionGates.mikrotikWorkerCommit()).toBe(false);
    expect(mod.productionGates.notificationsLive()).toBe(false);
  });

  it('NUGACORE_LIVE_MODE enables subsystems', async () => {
    process.env.NUGACORE_LIVE_MODE = 'true';
    vi.resetModules();
    const mod = await import('../../backend/config/production-gates');
    expect(mod.productionGates.liveMode()).toBe(true);
    expect(mod.productionGates.mikrotikWorkerLive()).toBe(true);
    expect(mod.productionGates.provisioningExecute()).toBe(true);
  });
});
