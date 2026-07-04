import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// FASE D — Customer 360: el panel integral muestra la cobranza del cliente
// (saldo actual, vencido, facturas pendientes/vencidas, último pago + fecha)
// y ofrece las acciones rápidas Ver facturas / Registrar pago / Ver estado
// de cuenta. NO suspende ni reactiva desde la sección de cobranza.
// ====================================================================

const panelSource = readFileSync('src/components/Client360Panel.tsx', 'utf8');
const crmSource = readFileSync('src/components/CrmModule.tsx', 'utf8');

describe('Client360Panel — sección Cobranza', () => {
  it('acepta el resumen de cobranza como prop opcional', () => {
    expect(panelSource).toContain('export interface ClientBillingSummary');
    expect(panelSource).toContain('billing?: ClientBillingSummary | null');
  });

  it('muestra los indicadores de cobranza requeridos', () => {
    expect(panelSource).toContain('client360-billing');
    expect(panelSource).toContain('Saldo actual');
    expect(panelSource).toContain('Saldo vencido');
    expect(panelSource).toContain('Facturas pendientes');
    expect(panelSource).toContain('Facturas vencidas');
    expect(panelSource).toContain('Último pago');
    expect(panelSource).toContain('Fecha último pago');
  });

  it('ofrece las acciones rápidas de cobranza', () => {
    expect(panelSource).toContain('Ver facturas');
    expect(panelSource).toContain('Registrar pago');
    expect(panelSource).toContain('Ver estado de cuenta');
    expect(panelSource).toContain("key: 'view-invoices'");
    expect(panelSource).toContain("key: 'register-payment'");
    expect(panelSource).toContain("key: 'account-statement'");
  });

  it('la sección de cobranza no incluye suspender/reactivar', () => {
    const billingBlock = panelSource.slice(
      panelSource.indexOf('const BILLING_ACTIONS'),
      panelSource.indexOf('export default function Client360Panel'),
    );
    expect(billingBlock).not.toContain('suspend');
    expect(billingBlock).not.toContain('reactivate');
  });
});

describe('CrmModule — carga del balance del cliente', () => {
  it('consulta el endpoint de balance vía Bearer (getAuthHeaders)', () => {
    expect(crmSource).toContain('/api/billing/customers/${customerId}/balance');
    expect(crmSource).toContain('createAuthorizedApi(getAuthHeaders)');
  });

  it('pasa el resumen de cobranza al panel', () => {
    expect(crmSource).toContain('billing={client360Billing}');
  });

  it('maneja la acción view-invoices', () => {
    expect(crmSource).toContain("case 'view-invoices':");
  });
});
