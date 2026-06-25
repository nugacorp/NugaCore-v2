import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notificationService } from '../../backend/domains/notifications/service';
import { notificationStore } from '../../backend/domains/notifications/store';

const input = {
  type: 'PAYMENT_REMINDER',
  customerId: 'cust-1',
  variables: { customerName: 'Ana', amount: '$300.00', dueDate: '2026-07-01', invoiceId: 'INV-9' },
};

describe('notifications service', () => {
  beforeEach(() => notificationStore.clearForTests());
  afterEach(() => notificationStore.clearForTests());

  it('preview interpola variables y no persiste', () => {
    const result = notificationService.preview(input);
    expect(result.dryRun).toBe(true);
    expect(result.wouldSend).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.renderedBody).toContain('Ana');
    expect(result.renderedBody).toContain('$300.00');
    expect(notificationService.listMessages()).toHaveLength(0);
  });

  it('createMessage genera DRAFT dry-run sent=false', () => {
    const msg = notificationService.createMessage(input, 'tester');
    expect(msg.status).toBe('DRAFT');
    expect(msg.dryRun).toBe(true);
    expect(msg.sent).toBe(false);
    expect(msg.provider).toBe('mock');
    expect(msg.customerId).toBe('cust-1');
  });

  it('simulateMessage pasa a SIMULATED y nunca a SENT', () => {
    const msg = notificationService.createMessage(input, 'tester');
    const sim = notificationService.simulateMessage(msg.id, 'tester');
    expect(sim.status).toBe('SIMULATED');
    expect(sim.sent).toBe(false);
    expect(sim.simulationResult).toContain('sent=false');
  });

  it('no permite simular un mensaje ya simulado', () => {
    const msg = notificationService.createMessage(input, 'tester');
    notificationService.simulateMessage(msg.id, 'tester');
    expect(() => notificationService.simulateMessage(msg.id, 'tester')).toThrow();
  });

  it('cancelMessage marca CANCELLED', () => {
    const msg = notificationService.createMessage(input, 'tester');
    const cancelled = notificationService.cancelMessage(msg.id, 'tester', 'motivo');
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelReason).toBe('motivo');
  });

  it('type invalido lanza error', () => {
    expect(() => notificationService.preview({ type: 'NOPE' })).toThrow();
  });

  it('pendingCount cuenta DRAFT+QUEUED+SIMULATED y excluye CANCELLED', () => {
    const a = notificationService.createMessage(input, 'tester'); // DRAFT
    const b = notificationService.createMessage(input, 'tester');
    notificationService.simulateMessage(b.id, 'tester'); // SIMULATED
    const c = notificationService.createMessage(input, 'tester');
    notificationService.cancelMessage(c.id, 'tester'); // CANCELLED (excluido)
    expect(a.status).toBe('DRAFT');
    expect(notificationService.pendingCount()).toBe(2);
  });

  it('summary refleja tipos/canales/templates y dryRun', () => {
    const s = notificationService.summary();
    expect(s.supportedTypes).toBe(9);
    expect(s.supportedChannels).toBe(5);
    expect(s.templates).toBe(8);
    expect(s.dryRun).toBe(true);
  });

  it('messagesForCustomer filtra por cliente', () => {
    notificationService.createMessage({ ...input, customerId: 'cust-a' }, 'tester');
    notificationService.createMessage({ ...input, customerId: 'cust-b' }, 'tester');
    const a = notificationService.messagesForCustomer('cust-a');
    expect(a).toHaveLength(1);
    expect(a[0].customerId).toBe('cust-a');
  });
});
