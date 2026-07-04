import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAccessTab } from '../../src/lib/rbac';
import { canWritePayments } from '../../src/lib/paymentsRbac';

const paymentsSource = readFileSync('src/components/PaymentsModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('PaymentsModule — Bearer auth headers', () => {
  it('recibe getAuthHeaders como prop obligatoria', () => {
    expect(paymentsSource).toContain(
      'getAuthHeaders: () => Promise<Record<string, string>>',
    );
    expect(paymentsSource).toContain(
      'PaymentsModule({ userRole, getAuthHeaders }',
    );
  });

  it('usa getAuthHeaders para cargar orders y actions', () => {
    expect(paymentsSource).toContain('createAuthorizedApi(getAuthHeaders)');
    expect(paymentsSource).toContain("'/api/payments/orders'");
    expect(paymentsSource).toContain("'/api/payments/actions'");
  });

  it('usa getAuthHeaders en creación de órdenes y reactivación', () => {
    expect(paymentsSource).toContain('createAuthorizedApi(getAuthHeaders)');
    expect(paymentsSource).toContain("api.post<PaymentOrderView>('/api/payments/orders'");
    expect(paymentsSource).toContain(
      '`/api/payments/customers/${reactivateId.trim()}/reactivate`',
    );
  });

  it('no autoafirma identidad con trusted headers', () => {
    expect(paymentsSource).not.toContain('x-user-role');
    expect(paymentsSource).not.toContain('x-user-id');
    expect(paymentsSource).not.toContain("const authHeaders = ()");
  });

  it('App pasa getAuthHeaders al módulo Pagos', () => {
    expect(appSource).toContain('<PaymentsModule');
    expect(appSource).toContain('getAuthHeaders={getAuthHeaders}');
  });
});

describe('Payments hotfix — RBAC sin regresiones', () => {
  it('conserva visibilidad de Pagos para los roles existentes', () => {
    expect(canAccessTab('Super Admin', 'payments')).toBe(true);
    expect(canAccessTab('Administrador', 'payments')).toBe(true);
    expect(canAccessTab('Cobranza', 'payments')).toBe(true);
    expect(canAccessTab('Técnico', 'payments')).toBe(false);
    expect(canAccessTab('Soporte', 'payments')).toBe(false);
    expect(canAccessTab('Solo lectura', 'payments')).toBe(false);
  });

  it('conserva canWritePayments', () => {
    expect(canWritePayments('Super Admin')).toBe(true);
    expect(canWritePayments('Administrador')).toBe(true);
    expect(canWritePayments('Cobranza')).toBe(true);
    expect(canWritePayments('Técnico')).toBe(false);
    expect(canWritePayments('Soporte')).toBe(false);
    expect(canWritePayments('Solo lectura')).toBe(false);
  });
});
