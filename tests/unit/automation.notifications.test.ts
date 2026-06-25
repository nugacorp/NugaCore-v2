import { describe, expect, it } from 'vitest';
import { buildExecutionPreview } from '../../backend/domains/automation/rules';

// FASE H — Automation Integration. La decisión REQUEST_NOTIFICATION debe
// indicar que se crearía una notificación, en modo dry-run, sin enviar nada.
describe('automation → notification integration (FASE H)', () => {
  it('REQUEST_NOTIFICATION incluye "Notification would be created" (dry-run)', () => {
    const preview = buildExecutionPreview('REQUEST_NOTIFICATION', 'cust-1');
    const joined = preview.map((step) => step.description).join(' | ');
    expect(joined).toContain('Notification would be created');
    expect(joined.toLowerCase()).toContain('dry-run');
  });

  it('el preview de notificación no describe envío real', () => {
    const joined = buildExecutionPreview('REQUEST_NOTIFICATION')
      .map((step) => step.description)
      .join(' ')
      .toLowerCase();
    for (const forbidden of ['whatsapp real', 'telegram bot api real', 'push real', 'dispatch']) {
      expect(joined).not.toContain(forbidden);
    }
  });
});
