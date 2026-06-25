import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { automationService } from '../../backend/domains/automation/service';
import { automationStore } from '../../backend/domains/automation/store';

describe('automation service', () => {
  beforeEach(() => automationStore.clearForTests());
  afterEach(() => automationStore.clearForTests());

  it('simulate devuelve decisiones descriptivas dry-run', () => {
    const result = automationService.simulate(
      { event: 'INVOICE_OVERDUE', customerId: 'cust-1', payload: { daysOverdue: 5 } },
      'tester',
    );
    expect(result.dryRun).toBe(true);
    expect(result.event).toBe('INVOICE_OVERDUE');
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.decisions[0].decision).toBe('REQUEST_SUSPENSION');
    expect(result.decisions.every((d) => d.dryRun === true)).toBe(true);
    expect(result.decisions.every((d) => d.status === 'PENDING')).toBe(true);
  });

  it('event invalido lanza error', () => {
    expect(() => automationService.simulate({ event: 'NOPE' }, 'tester')).toThrow();
  });

  it('payload condicional: PAYMENT_REGISTERED sin wasSuspended no propone reactivacion', () => {
    const withFlag = automationService.simulate(
      { event: 'PAYMENT_REGISTERED', customerId: 'c1', payload: { wasSuspended: true } },
      'tester',
    );
    const withoutFlag = automationService.simulate(
      { event: 'PAYMENT_REGISTERED', customerId: 'c2', payload: {} },
      'tester',
    );
    expect(withFlag.decisions.map((d) => d.decision)).toContain('REQUEST_REACTIVATION');
    expect(withoutFlag.decisions.map((d) => d.decision)).not.toContain('REQUEST_REACTIVATION');
  });

  it('summary refleja reglas, eventos y decisiones pendientes', () => {
    automationService.simulate({ event: 'TICKET_CREATED', customerId: 'c1' }, 'tester');
    const summary = automationService.summary();
    expect(summary.totalRules).toBeGreaterThan(0);
    expect(summary.supportedEvents).toBe(16);
    expect(summary.supportedDecisions).toBe(9);
    expect(summary.pendingDecisions).toBeGreaterThan(0);
    expect(summary.simulationsRun).toBe(1);
    expect(summary.dryRun).toBe(true);
  });

  it('pendingDecisionsCount alimenta el KPI Automation Queue', () => {
    expect(automationService.pendingDecisionsCount()).toBe(0);
    automationService.simulate({ event: 'NOC_ALERT', customerId: 'c1', payload: { severity: 'critical' } }, 'tester');
    expect(automationService.pendingDecisionsCount()).toBeGreaterThan(0);
  });

  it('decisionsForCustomer filtra por cliente', () => {
    automationService.simulate({ event: 'TICKET_CREATED', customerId: 'cust-a' }, 'tester');
    automationService.simulate({ event: 'TICKET_CREATED', customerId: 'cust-b' }, 'tester');
    const a = automationService.decisionsForCustomer('cust-a');
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((d) => d.customerId === 'cust-a')).toBe(true);
  });
});
