import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('production-readiness', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.STAGING_RESTORE_TESTED;
    for (const key of [
      'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
      'USE_DB_SUSPENSION', 'USE_DB_INVENTORY', 'USE_DB_SUPPORT',
    ]) {
      delete process.env[key];
    }
  });

  it('reports blockers when persistence incomplete', async () => {
    const { productionReadinessSnapshot } = await import('../../backend/config/production-readiness');
    const snap = productionReadinessSnapshot();
    expect(snap.readyForLiveWisp).toBe(false);
    expect(snap.blockers.length).toBeGreaterThan(0);
  });

  it('ready when critical flags and restore tested', async () => {
    for (const key of [
      'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
      'USE_DB_SUSPENSION', 'USE_DB_INVENTORY', 'USE_DB_SUPPORT',
    ]) {
      process.env[key] = 'true';
    }
    process.env.STAGING_RESTORE_TESTED = 'true';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.AUTH_TRUST_HEADERS = 'false';
    const { productionReadinessSnapshot } = await import('../../backend/config/production-readiness');
    const snap = productionReadinessSnapshot();
    expect(snap.blockers).toEqual([]);
    expect(snap.readyForLiveWisp).toBe(true);
  });
});
