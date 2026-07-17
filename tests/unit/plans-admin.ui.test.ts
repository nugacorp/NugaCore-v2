import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const billing = readFileSync(resolve('src/components/BillingModule.tsx'), 'utf8');
const plansPanel = readFileSync(resolve('src/components/PlansAdminPanel.tsx'), 'utf8');
const crm = readFileSync(resolve('src/components/CrmModule.tsx'), 'utf8');

describe('Plans admin + zone-aware client create UI', () => {
  it('BillingModule tiene pestaña Planes con panel de administración', () => {
    expect(billing).toContain('billing-tab-plans');
    expect(billing).toContain('PlansAdminPanel');
    expect(plansPanel).toContain('/api/plans');
    expect(plansPanel).toContain('Nuevo plan');
  });

  it('CrmModule exige zona de servicio y muestra megas del plan', () => {
    expect(crm).toContain('customer-billing-zone');
    expect(crm).toContain('billingZoneId');
    expect(crm).toContain('speedMbpsDown');
    expect(crm).toContain('Facturación → Planes');
  });
});
