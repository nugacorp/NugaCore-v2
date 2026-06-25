import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { automationService } from '../../backend/domains/automation/service';
import { automationStore } from '../../backend/domains/automation/store';
import { auditForCustomer, listAudit } from '../../backend/domains/automation/audit';

describe('automation audit (FASE M)', () => {
  beforeEach(() => automationStore.clearForTests());
  afterEach(() => automationStore.clearForTests());

  it('cada simulacion registra una entrada de auditoria descriptiva', () => {
    automationService.simulate(
      { event: 'INVOICE_OVERDUE', customerId: 'cust-1', payload: { daysOverdue: 3 } },
      'auditor',
    );
    const audit = listAudit();
    expect(audit).toHaveLength(1);
    const entry = audit[0];
    expect(entry.event).toBe('INVOICE_OVERDUE');
    expect(entry.actor).toBe('auditor');
    expect(entry.dryRun).toBe(true);
    expect(entry.rulesEvaluated).toBeGreaterThan(0);
    expect(entry.rulesMatched.length).toBeGreaterThan(0);
    expect(entry.decisions).toContain('REQUEST_SUSPENSION');
    expect(entry.executionPreview.length).toBeGreaterThan(0);
    expect(entry.createdAt).toBeTruthy();
  });

  it('la auditoria nunca expone secretos del payload', () => {
    automationService.simulate(
      { event: 'PAYMENT_REGISTERED', customerId: 'cust-2', payload: { password: 'super-secret', token: 'abc123' } },
      'auditor',
    );
    const serialized = JSON.stringify(listAudit());
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('abc123');
  });

  it('auditForCustomer filtra por cliente', () => {
    automationService.simulate({ event: 'TICKET_CREATED', customerId: 'cust-a' }, 'auditor');
    automationService.simulate({ event: 'TICKET_CREATED', customerId: 'cust-b' }, 'auditor');
    const a = auditForCustomer('cust-a');
    expect(a).toHaveLength(1);
    expect(a[0].customerId).toBe('cust-a');
  });
});
