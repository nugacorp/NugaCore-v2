import { describe, it, expect } from 'vitest';
import {
  serviceStatusBadge,
  billingStatusBadge,
  orderStatusBadge,
  bucketByServiceStatus,
} from '../../src/lib/suspensionView';
import { canEvaluateSuspension, canManageSuspensionPolicy } from '../../src/lib/suspensionRbac';
import type { CustomerServiceView } from '../../src/types';

describe('suspensionView badges', () => {
  it('mapea ServiceStatus', () => {
    expect(serviceStatusBadge('PENDING_SUSPENSION').tone).toBe('danger');
    expect(serviceStatusBadge('SUSPENDED').tone).toBe('suspended');
    expect(serviceStatusBadge('PENDING_REACTIVATION').tone).toBe('info');
    expect(serviceStatusBadge('ACTIVE').tone).toBe('active');
  });
  it('mapea BillingStatus y OrderStatus', () => {
    expect(billingStatusBadge('DELINQUENT').tone).toBe('danger');
    expect(orderStatusBadge('PENDING').tone).toBe('warning');
    expect(orderStatusBadge('CANCELLED').tone).toBe('neutral');
  });
});

describe('bucketByServiceStatus', () => {
  it('cuenta clientes por estado de servicio', () => {
    const customers = [
      { serviceStatus: 'ACTIVE' }, { serviceStatus: 'ACTIVE' },
      { serviceStatus: 'WARNING' }, { serviceStatus: 'PENDING_SUSPENSION' },
      { serviceStatus: 'SUSPENDED' }, { serviceStatus: 'PENDING_REACTIVATION' },
    ] as CustomerServiceView[];
    const b = bucketByServiceStatus(customers);
    expect(b.ACTIVE).toBe(2);
    expect(b.WARNING).toBe(1);
    expect(b.PENDING_SUSPENSION).toBe(1);
    expect(b.SUSPENDED).toBe(1);
    expect(b.PENDING_REACTIVATION).toBe(1);
  });
});

describe('suspensionRbac', () => {
  it('evaluar: SA / Admin / Cobranza', () => {
    expect(canEvaluateSuspension('Cobranza')).toBe(true);
    expect(canEvaluateSuspension('Administrador')).toBe(true);
    expect(canEvaluateSuspension('Técnico')).toBe(false);
    expect(canEvaluateSuspension('Soporte')).toBe(false);
  });
  it('política: solo SA / Admin', () => {
    expect(canManageSuspensionPolicy('Super Admin')).toBe(true);
    expect(canManageSuspensionPolicy('Cobranza')).toBe(false);
  });
});
