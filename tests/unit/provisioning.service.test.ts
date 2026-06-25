import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisioningService, buildExecutionPlan } from '../../backend/domains/provisioning/service';
import { provisioningStore } from '../../backend/domains/provisioning/store';
import { PROVISIONING_STATUSES } from '../../backend/domains/provisioning/types';

describe('provisioningService', () => {
  beforeEach(() => provisioningStore.clearForTests());
  afterEach(() => provisioningStore.clearForTests());

  it('soporta los estados requeridos sin estados live', () => {
    expect(PROVISIONING_STATUSES).toEqual(['PENDING', 'VALIDATED', 'SIMULATED', 'APPROVED', 'REJECTED', 'CANCELLED']);
  });

  it('genera planes por tipo de accion', () => {
    expect(buildExecutionPlan('SUSPEND_CUSTOMER', 'cust-1').map((s) => s.description).join(' ')).toContain('SUSPENSION_PENDING');
    expect(buildExecutionPlan('CHANGE_PLAN', 'cust-1', 'Fibra 200').map((s) => s.description).join(' ')).toContain('Recalcular MRR');
    expect(buildExecutionPlan('CREATE_CUSTOMER', 'cust-1').map((s) => s.description).join(' ')).toContain('Validar IP');
  });

  it('transiciona validate, simulate y approve con dryRun', () => {
    const action = provisioningService.createAction({ actionType: 'CHANGE_PLAN', customerId: 'cust-1' }, 'tester');
    expect(action.status).toBe('PENDING');
    expect(action.dryRun).toBe(true);
    expect(provisioningService.validateAction(action.id, 'tester').status).toBe('VALIDATED');
    expect(provisioningService.simulateAction(action.id, 'tester').status).toBe('SIMULATED');
    expect(provisioningService.approveAction(action.id, 'boss').status).toBe('APPROVED');
  });

  it('bloquea transiciones invalidas y terminales', () => {
    const action = provisioningService.createAction({ actionType: 'CANCEL_CUSTOMER', customerId: 'cust-1' }, 'tester');
    expect(() => provisioningService.approveAction(action.id, 'tester')).toThrow();
    provisioningService.rejectAction(action.id, 'tester', 'no');
    expect(() => provisioningService.validateAction(action.id, 'tester')).toThrow();
  });
});
