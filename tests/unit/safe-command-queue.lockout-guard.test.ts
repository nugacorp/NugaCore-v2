import { describe, expect, it } from 'vitest';
import { planRouterOsCommands } from '../../backend/domains/safe-command-queue/command-planner';
import { analyzeLockoutRisk } from '../../backend/domains/safe-command-queue/lockout-guard';

describe('planRouterOsCommands', () => {
  it('genera plan de suspensión alineado con el worker', () => {
    const plan = planRouterOsCommands({
      commandType: 'SUSPEND_CUSTOMER',
      targetId: 'cust-1',
      payload: { pppoeUser: 'user1', ip: '10.100.10.5' },
    });
    expect(plan.some((c) => c.includes('/ppp secret disable'))).toBe(true);
    expect(plan.some((c) => c.includes('address-list add'))).toBe(true);
  });
});

describe('analyzeLockoutRisk', () => {
  it('marca blocked para input drop sin scope', () => {
    const analysis = analyzeLockoutRisk(
      ['/ip firewall filter add chain=input action=drop'],
      { managementCidr: '10.0.0.0/24', vpnCidr: '10.10.0.0/24' },
    );
    expect(analysis.risk).toBe('blocked');
    expect(analysis.blocked).toBe(true);
  });

  it('marca blocked si address-list apunta a IP del CIDR de gestión', () => {
    const analysis = analyzeLockoutRisk(
      ['/ip firewall address-list add list=BLOCK address=10.0.0.1'],
      { managementCidr: '10.0.0.0/24' },
    );
    expect(analysis.risk).toBe('blocked');
  });

  it('marca possible para reboot', () => {
    const analysis = analyzeLockoutRisk(['/system reboot'], {});
    expect(analysis.risk).toBe('possible');
    expect(analysis.blocked).toBe(false);
  });

  it('none para planes de suspensión típicos fuera de CIDR gestión', () => {
    const plan = planRouterOsCommands({
      commandType: 'SUSPEND_CUSTOMER',
      targetId: 'cust-1',
      payload: { pppoeUser: 'user1', ip: '10.100.10.5' },
    });
    const analysis = analyzeLockoutRisk(plan, {
      managementCidr: '10.0.0.0/24',
      vpnCidr: '10.10.0.0/24',
    });
    expect(analysis.risk).toBe('none');
  });
});
