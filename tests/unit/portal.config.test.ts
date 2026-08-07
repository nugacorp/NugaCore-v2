import { describe, expect, it, beforeEach } from 'vitest';
import {
  getPortalConfig,
  getPortalFeatures,
  isPortalFeatureEnabled,
  resetPortalConfigForTests,
  updatePortalConfig,
} from '../../backend/domains/portal/config-service';
import { DEFAULT_PORTAL_FEATURES } from '../../backend/domains/portal/types';

// Sin Supabase configurado, el servicio usa el respaldo en memoria. Estos
// tests cubren esa vía y el contrato de la API; que la persistencia REAL
// funcione sólo puede demostrarlo el gate de PostgreSQL, no esta suite.
describe('portal config service', () => {
  beforeEach(() => {
    resetPortalConfigForTests();
  });

  it('devuelve todas las funciones habilitadas por defecto', async () => {
    expect(await getPortalFeatures('tenant-a')).toEqual(DEFAULT_PORTAL_FEATURES);
  });

  it('guarda toggles por tenant sin contaminar a los demás', async () => {
    await updatePortalConfig('tenant-a', { features: { invoices: false, tickets: false } });

    expect(await getPortalFeatures('tenant-a')).toMatchObject({
      invoices: false,
      tickets: false,
      balance: true,
    });
    expect(await getPortalFeatures('tenant-b')).toEqual(DEFAULT_PORTAL_FEATURES);
  });

  it('conserva los toggles previos al aplicar un parcial', async () => {
    await updatePortalConfig('tenant-a', { features: { invoices: false } });
    await updatePortalConfig('tenant-a', { features: { tickets: false } });

    const features = await getPortalFeatures('tenant-a');
    expect(features.invoices).toBe(false);
    expect(features.tickets).toBe(false);
  });

  it('getPortalConfig incluye tenantId', async () => {
    const cfg = await getPortalConfig('tenant-x');

    expect(cfg.tenantId).toBe('tenant-x');
    expect(cfg.features.balance).toBe(true);
    expect(cfg.updatedAt).toBeTruthy();
  });

  it('isPortalFeatureEnabled refleja el toggle guardado', async () => {
    expect(await isPortalFeatureEnabled('tenant-a', 'invoices')).toBe(true);

    await updatePortalConfig('tenant-a', { features: { invoices: false } });

    expect(await isPortalFeatureEnabled('tenant-a', 'invoices')).toBe(false);
  });

  it('ignora claves desconocidas en lugar de guardarlas', async () => {
    await updatePortalConfig('tenant-a', {
      features: { invoices: false, noExiste: true } as never,
    });

    const features = await getPortalFeatures('tenant-a');
    expect(features).toEqual({ ...DEFAULT_PORTAL_FEATURES, invoices: false });
    expect('noExiste' in features).toBe(false);
  });

  it('rechaza un tenantId vacío', async () => {
    await expect(updatePortalConfig('  ', { features: { invoices: false } })).rejects.toThrow();
  });
});
