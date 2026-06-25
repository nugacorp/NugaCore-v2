import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisioningService } from '../../backend/domains/provisioning/service';
import { provisioningStore } from '../../backend/domains/provisioning/store';

describe('provisioning audit', () => {
  beforeEach(() => provisioningStore.clearForTests());
  afterEach(() => provisioningStore.clearForTests());

  it('guarda campos de auditoria requeridos en cada cambio de estado', () => {
    const action = provisioningService.createAction({ actionType: 'CREATE_CUSTOMER', customerId: 'cust-new' }, 'creator');
    provisioningService.validateAction(action.id, 'validator');
    provisioningService.simulateAction(action.id, 'simulator');

    const detail = provisioningService.getAction(action.id);
    expect(detail.audit).toHaveLength(3);
    expect(detail.audit[0]).toMatchObject({
      actionType: 'CREATE_CUSTOMER',
      customerId: 'cust-new',
      previousState: null,
      nextState: 'PENDING',
      actor: 'creator',
      dryRun: true,
    });
    expect(detail.audit[2]).toMatchObject({
      previousState: 'VALIDATED',
      nextState: 'SIMULATED',
      actor: 'simulator',
      dryRun: true,
    });
    expect(detail.audit[2].executionPlan.length).toBeGreaterThan(0);
  });
});
