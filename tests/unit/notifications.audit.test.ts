import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notificationService } from '../../backend/domains/notifications/service';
import { notificationStore } from '../../backend/domains/notifications/store';
import { listAllAudit, listAuditForMessage } from '../../backend/domains/notifications/audit';

const input = {
  type: 'PAYMENT_REMINDER',
  customerId: 'cust-1',
  variables: { customerName: 'Ana', token: 'secret-token-123', password: 'p4ss' },
};

describe('notifications audit', () => {
  beforeEach(() => notificationStore.clearForTests());
  afterEach(() => notificationStore.clearForTests());

  it('registra transiciones DRAFT y SIMULATED con dryRun/sent=false', () => {
    const msg = notificationService.createMessage(input, 'auditor');
    notificationService.simulateMessage(msg.id, 'auditor');
    const audit = listAuditForMessage(msg.id);
    expect(audit.length).toBe(2);
    expect(audit.map((a) => a.nextStatus).sort()).toEqual(['DRAFT', 'SIMULATED']);
    expect(audit.every((a) => a.dryRun === true && a.sent === false)).toBe(true);
    expect(audit.every((a) => a.actor === 'auditor')).toBe(true);
  });

  it('la auditoría nunca expone tokens ni secretos', () => {
    const msg = notificationService.createMessage(input, 'auditor');
    notificationService.simulateMessage(msg.id, 'auditor');
    const serialized = JSON.stringify(listAllAudit());
    expect(serialized).not.toContain('secret-token-123');
    expect(serialized).not.toContain('p4ss');
  });

  it('registra la cancelación', () => {
    const msg = notificationService.createMessage(input, 'auditor');
    notificationService.cancelMessage(msg.id, 'auditor');
    const audit = listAuditForMessage(msg.id);
    expect(audit.some((a) => a.nextStatus === 'CANCELLED')).toBe(true);
  });
});
