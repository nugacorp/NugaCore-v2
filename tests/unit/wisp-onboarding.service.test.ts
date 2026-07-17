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
      phone: '5551234567',
    });
    expect(reg.tenantId).toBeTruthy();
    expect(reg.onboarding.status).toBe('in_progress');
    // Datos del registro ya persisten: no repetir paso company.
    expect(reg.onboarding.companyName).toBe('Red Alfa');
    expect(reg.onboarding.city).toBe('CDMX');
    expect(reg.onboarding.contactPhone).toBe('5551234567');
    expect(reg.onboarding.completedSteps).toContain('company');
    expect(reg.onboarding.currentStep).toBe('zone');
    expect(reg.emailConfirmationRequired).toBe(false);
    expect(await svc.isOnboardingRequired(reg.tenantId)).toBe(true);

    await svc.saveZone(reg.tenantId, { zoneName: 'Zona Norte' });
    await svc.saveBilling(reg.tenantId, { billingCycleDay: 5, billingCycleTime: '09:00' });
    await svc.saveRouter(reg.tenantId, { routerName: 'CHR-01' });
    const done = await svc.complete(reg.tenantId);
    expect(done.status).toBe('completed');
    expect(await svc.isOnboardingRequired(reg.tenantId)).toBe(false);
  });

  it('getStatus repara filas antiguas con empresa del registro sin paso company', async () => {
    const svc = getWispOnboardingService();
    const reg = await svc.register({
      companyName: 'Red Legacy',
      slug: 'red-legacy',
      email: 'owner@redlegacy.test',
      password: 'secreto123',
      fullName: 'Legacy Owner',
      city: 'Ensenada',
    });
    // Simula fila antigua (antes del skip de company).
    await (svc as unknown as {
      repo: {
        upsert: (s: Record<string, unknown>) => Promise<unknown>;
      };
    }).repo.upsert({
      tenantId: reg.tenantId,
      status: 'in_progress',
      currentStep: 'company',
      companyName: 'Red Legacy',
      city: 'Ensenada',
      completedSteps: [],
      updatedAt: new Date().toISOString(),
    });
    const healed = await svc.getStatus(reg.tenantId);
    expect(healed?.completedSteps).toContain('company');
    expect(healed?.currentStep).toBe('zone');
    expect(healed?.companyName).toBe('Red Legacy');
  });

  it('tenant-default no fuerza onboarding', async () => {
    const svc = getWispOnboardingService();
    expect(await svc.isOnboardingRequired('tenant-default')).toBe(false);
  });

  it('saveCompany recrea tenant ausente para no fallar por FK', async () => {
    const { getTenancyService } = await import('../../backend/domains/tenancy/service');
    const tenancy = getTenancyService();
    const orphanId = 'tenant-orphan-heal-01';
    expect(await tenancy.getTenant(orphanId)).toBeNull();

    const svc = getWispOnboardingService();
    const saved = await svc.saveCompany(orphanId, {
      companyName: 'Heal Corp',
      city: 'Tijuana',
      ownerUserId: 'user-heal-1',
    });
    expect(saved.companyName).toBe('Heal Corp');
    expect(saved.completedSteps).toContain('company');
    expect(await tenancy.getTenant(orphanId)).toBeTruthy();
  });
});
