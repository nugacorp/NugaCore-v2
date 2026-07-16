import { beforeEach, describe, expect, it } from 'vitest';
import { resetTenancyService } from '../../backend/domains/tenancy/service';
import {
  getWispOnboardingService,
  resetWispOnboardingService,
} from '../../backend/domains/wisp-onboarding/service';

describe('WispOnboardingService', () => {
  beforeEach(() => {
    resetTenancyService();
    resetWispOnboardingService();
  });

  it('registra WISP y exige pasos hasta complete', async () => {
    const svc = getWispOnboardingService();
    const reg = await svc.register({
      companyName: 'Red Alfa',
      slug: 'red-alfa',
      email: 'owner@redalfa.test',
      password: 'secreto123',
      fullName: 'Ana Owner',
      city: 'CDMX',
    });
    expect(reg.tenantId).toBeTruthy();
    expect(reg.onboarding.status).toBe('in_progress');
    expect(await svc.isOnboardingRequired(reg.tenantId)).toBe(true);

    await svc.saveCompany(reg.tenantId, { companyName: 'Red Alfa', city: 'CDMX' });
    await svc.saveZone(reg.tenantId, { zoneName: 'Zona Norte' });
    await svc.saveBilling(reg.tenantId, { billingCycleDay: 5, billingCycleTime: '09:00' });
    await svc.saveRouter(reg.tenantId, { routerName: 'CHR-01' });
    const done = await svc.complete(reg.tenantId);
    expect(done.status).toBe('completed');
    expect(await svc.isOnboardingRequired(reg.tenantId)).toBe(false);
  });

  it('tenant-default no fuerza onboarding', async () => {
    const svc = getWispOnboardingService();
    expect(await svc.isOnboardingRequired('tenant-default')).toBe(false);
  });
});
