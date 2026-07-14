import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDashboardStats } from '../../backend/domains/dashboard/routes';
import { notificationService } from '../../backend/domains/notifications/service';
import { notificationStore } from '../../backend/domains/notifications/store';

const input = { type: 'PAYMENT_REMINDER', customerId: 'c1', variables: { customerName: 'Ana' } };

describe('dashboard Notificaciones Pendientes KPI (FASE M)', () => {
  beforeEach(() => notificationStore.clearForTests());
  afterEach(() => notificationStore.clearForTests());

  it('cuenta DRAFT+QUEUED+SIMULATED y excluye CANCELLED', async () => {
    const empty = await buildDashboardStats();
    expect(empty.notificationsPending).toBe(0);

    notificationService.createMessage(input, 'tester'); // DRAFT
    const b = notificationService.createMessage(input, 'tester');
    notificationService.simulateMessage(b.id, 'tester'); // SIMULATED
    const c = notificationService.createMessage(input, 'tester');
    notificationService.cancelMessage(c.id, 'tester'); // CANCELLED (excluido)

    const stats = await buildDashboardStats();
    expect(stats.notificationsPending).toBe(2);
    expect(stats.notificationsPending).toBe(notificationService.pendingCount());
  });

  it('Dashboard ya no muestra Notificaciones Pendientes (vive en módulo Notifications)', () => {
    const source = readFileSync('src/components/Dashboard.tsx', 'utf8');
    expect(source).not.toContain('Notificaciones Pendientes');
    expect(source).not.toContain('kpi-notifications-pending');
  });
});
