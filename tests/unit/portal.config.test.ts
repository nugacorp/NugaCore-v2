import { describe, expect, it, beforeEach } from 'vitest';
import {
  getPortalConfig,
  getPortalFeatures,
  resetPortalConfigForTests,
  updatePortalConfig,
} from '../../backend/domains/portal/config-service';
import { DEFAULT_PORTAL_FEATURES } from '../../backend/domains/portal/types';

describe('portal config service', () => {
  beforeEach(() => {
    resetPortalConfigForTests();
  });

  it('devuelve todas las funciones habilitadas por defecto', () => {
    expect(getPortalFeatures('tenant-a')).toEqual(DEFAULT_PORTAL_FEATURES);
  });

  it('persiste toggles por tenant', () => {
    updatePortalConfig('tenant-a', { features: { invoices: false, tickets: false } });
    expect(getPortalFeatures('tenant-a')).toMatchObject({ invoices: false, tickets: false, balance: true });
    expect(getPortalFeatures('tenant-b')).toEqual(DEFAULT_PORTAL_FEATURES);
  });

  it('getPortalConfig incluye tenantId', () => {
    const cfg = getPortalConfig('tenant-x');
    expect(cfg.tenantId).toBe('tenant-x');
    expect(cfg.features.balance).toBe(true);
    expect(cfg.updatedAt).toBeTruthy();
  });
});
