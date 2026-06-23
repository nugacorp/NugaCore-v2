import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { canManageBilling } from '../../src/lib/billingRbac';

// ====================================================================
// FASE H — Billing UI: el módulo de facturación consume la API v1 vía
// Bearer JWT (helper central getAuthHeaders → Authorization) y aplica el
// guard de acción canManageBilling. No autoafirma identidad con headers.
// ====================================================================

const billingSource = readFileSync('src/components/BillingModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('BillingModule — RBAC de acción', () => {
  it('usa canManageBilling para gatear escrituras', () => {
    expect(billingSource).toContain('canManageBilling');
  });

  it('no autoafirma identidad con trusted headers en el módulo', () => {
    expect(billingSource).not.toContain('x-user-role');
    expect(billingSource).not.toContain('x-user-id');
  });

  it('canManageBilling refleja WRITE_ROLES del backend', () => {
    expect(canManageBilling('Super Admin')).toBe(true);
    expect(canManageBilling('Administrador')).toBe(true);
    expect(canManageBilling('Cobranza')).toBe(true);
    expect(canManageBilling('Técnico')).toBe(false);
    expect(canManageBilling('Soporte')).toBe(false);
    expect(canManageBilling('Solo lectura')).toBe(false);
  });
});

describe('App — billing usa Bearer JWT vía fetchJson', () => {
  it('getAuthHeaders adjunta Authorization: Bearer', () => {
    expect(appSource).toContain('headers.Authorization = `Bearer ${accessToken}`');
  });

  it('las escrituras de billing pasan por fetchJson (autenticado)', () => {
    expect(appSource).toContain("fetchJson(`/api/billing/invoices/${invoiceId}/pay`");
    expect(appSource).toContain("fetchJson('/api/billing/invoices'");
  });

  it('la lectura de billing pasa por fetchJson', () => {
    expect(appSource).toContain("fetchJson('/api/billing/invoices')");
    expect(appSource).toContain("fetchJson('/api/billing/account-summary')");
  });
});
