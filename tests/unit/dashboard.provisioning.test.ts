import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDashboardStats } from '../../backend/domains/dashboard/routes';
import { provisioningService } from '../../backend/domains/provisioning/service';
import { provisioningStore } from '../../backend/domains/provisioning/store';
import { readFileSync } from 'node:fs';

describe('dashboard provisioning KPI', () => {
  beforeEach(() => provisioningStore.clearForTests());
  afterEach(() => provisioningStore.clearForTests());

  it('cuenta PENDING, VALIDATED y SIMULATED', async () => {
    const pending = provisioningService.createAction({ actionType: 'SUSPEND_CUSTOMER', customerId: 'cust-1' }, 'tester');
    const validated = provisioningService.createAction({ actionType: 'CHANGE_PLAN', customerId: 'cust-2' }, 'tester');
    const simulated = provisioningService.createAction({ actionType: 'CREATE_CUSTOMER', customerId: 'cust-3' }, 'tester');
    const approved = provisioningService.createAction({ actionType: 'CANCEL_CUSTOMER', customerId: 'cust-4' }, 'tester');

    provisioningService.validateAction(validated.id, 'tester');
    provisioningService.validateAction(simulated.id, 'tester');
    provisioningService.simulateAction(simulated.id, 'tester');
    provisioningService.validateAction(approved.id, 'tester');
    provisioningService.simulateAction(approved.id, 'tester');
    provisioningService.approveAction(approved.id, 'tester');

    const stats = await buildDashboardStats();
    expect(pending.status).toBe('PENDING');
    expect(stats.provisioningPending).toBe(3);
  });

  it('Dashboard ya no muestra Provisioning Pendiente (vive en módulo Provisioning)', () => {
    const source = readFileSync('src/components/Dashboard.tsx', 'utf8');
    expect(source).not.toContain('Provisioning Pendiente');
    expect(source).not.toContain('kpi-provisioning-pendiente');
  });
});
