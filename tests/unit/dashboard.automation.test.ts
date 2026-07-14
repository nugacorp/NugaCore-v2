import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDashboardStats } from '../../backend/domains/dashboard/routes';
import { automationService } from '../../backend/domains/automation/service';
import { automationStore } from '../../backend/domains/automation/store';

describe('dashboard Automation Queue KPI', () => {
  beforeEach(() => automationStore.clearForTests());
  afterEach(() => automationStore.clearForTests());

  it('cuenta las decisiones pendientes del motor', async () => {
    const empty = await buildDashboardStats();
    expect(empty.automationQueue).toBe(0);

    automationService.simulate({ event: 'INVOICE_OVERDUE', customerId: 'c1', payload: { daysOverdue: 2 } }, 'tester');
    const stats = await buildDashboardStats();
    expect(stats.automationQueue).toBeGreaterThan(0);
    expect(stats.automationQueue).toBe(automationService.pendingDecisionsCount());
  });

  it('Dashboard ya no muestra Automation Queue (vive en módulo NOC/Automation)', () => {
    const source = readFileSync('src/components/Dashboard.tsx', 'utf8');
    expect(source).not.toContain('Automation Queue');
    expect(source).not.toContain('kpi-automation-queue');
  });
});
