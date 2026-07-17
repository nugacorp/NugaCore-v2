import { describe, expect, it } from 'vitest';
import {
  buildCustomerMikrotikCommands,
  buildCustomerMikrotikPlanSteps,
} from '../../backend/domains/provisioning/customer-mikrotik-plan';

describe('customer MikroTik plan from real zone/plan data', () => {
  it('genera PPPoE + simple queue con megas del plan', () => {
    const cmds = buildCustomerMikrotikCommands({
      client: {
        id: 'c-1',
        name: 'Juan Perez',
        pppoeUser: 'juan_perez_12',
        pppoePassword: 'secret',
        assignedIp: '10.70.0.50',
        routerId: 'mkt-vg',
      },
      plan: {
        id: 'plan-50',
        name: 'Residencial 50/20',
        speedMbpsDown: 50,
        speedMbpsUp: 20,
        type: 'PPPoE',
      },
      zoneName: 'Vicente Guerrero',
    });
    expect(cmds.some((c) => c.includes('/ppp secret add') && c.includes('juan_perez_12'))).toBe(true);
    expect(cmds.some((c) => c.includes('/queue simple add') && c.includes('20M/50M'))).toBe(true);
  });

  it('incluye corte de zona en los pasos descriptivos', () => {
    const steps = buildCustomerMikrotikPlanSteps({
      client: {
        id: 'c-2',
        name: 'Ana',
        assignedIp: '10.70.0.51',
        routerId: 'mkt-vg',
      },
      plan: {
        id: 'plan-static',
        name: 'Empresarial 100/50',
        speedMbpsDown: 100,
        speedMbpsUp: 50,
        type: 'Static',
      },
      zoneName: 'Vicente Guerrero',
      billingCycleDay: 15,
      billingCycleTime: '06:00',
      routerName: 'CHR Vicente',
    });
    expect(steps.some((s) => /Vicente Guerrero/.test(s))).toBe(true);
    expect(steps.some((s) => /corte de zona día 15/i.test(s))).toBe(true);
    expect(steps.some((s) => s.includes('100/50'))).toBe(true);
  });
});
