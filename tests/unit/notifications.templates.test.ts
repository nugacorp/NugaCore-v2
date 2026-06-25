import { describe, expect, it } from 'vitest';
import { notificationService } from '../../backend/domains/notifications/service';
import { NOTIFICATION_TYPES } from '../../backend/domains/notifications/types';

describe('notifications templates (FASE G)', () => {
  it('existen 8 plantillas iniciales con cuerpo y variables', () => {
    const tpls = notificationService.listTemplates();
    expect(tpls).toHaveLength(8);
    for (const tpl of tpls) {
      expect(tpl.body.length).toBeGreaterThan(0);
      expect(Array.isArray(tpl.variables)).toBe(true);
      expect((NOTIFICATION_TYPES as readonly string[]).includes(tpl.type)).toBe(true);
    }
  });

  it('cubren los tipos esperados', () => {
    const types = notificationService.listTemplates().map((t) => t.type).sort();
    expect(types).toEqual([
      'INSTALLATION_REMINDER',
      'INVOICE_OVERDUE',
      'NOC_ALERT',
      'PAYMENT_REMINDER',
      'PROVISIONING_STATUS',
      'SERVICE_REACTIVATION_PENDING',
      'SERVICE_SUSPENSION_PENDING',
      'TICKET_UPDATE',
    ].sort());
  });

  it('interpola variables conocidas y deja — en faltantes', () => {
    const reminder = notificationService.preview({
      type: 'PAYMENT_REMINDER',
      variables: { customerName: 'Beto', amount: '$100', dueDate: '2026-08-01', invoiceId: 'INV-2' },
    });
    expect(reminder.renderedBody).toContain('Beto');
    expect(reminder.renderedBody).toContain('$100');
    expect(reminder.renderedBody).not.toContain('{{');

    const partial = notificationService.preview({ type: 'PAYMENT_REMINDER', variables: { customerName: 'Beto' } });
    expect(partial.renderedBody).toContain('Beto');
    expect(partial.renderedBody).toContain('—');
    expect(partial.renderedBody).not.toContain('{{amount}}');
  });

  it('soporta plantillas con alertType y routerName (NOC)', () => {
    const noc = notificationService.preview({
      type: 'NOC_ALERT',
      variables: { alertType: 'latency', routerName: 'CHR-01' },
    });
    expect(noc.renderedBody).toContain('latency');
    expect(noc.renderedBody).toContain('CHR-01');
  });
});
