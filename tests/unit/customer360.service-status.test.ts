import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Client 360 × Service Status (Pre-PROD-7). El panel muestra las 4
// dimensiones (CRM / cobranza / servicio / red) y las acciones Suspender /
// Reactivar llaman a request-suspension / request-reactivation indicando que
// NO se ejecutan cambios en MikroTik (estado pendiente).
// ====================================================================

const panelSource = readFileSync('src/components/Client360Panel.tsx', 'utf8');
const crmSource = readFileSync('src/components/CrmModule.tsx', 'utf8');

describe('Client360Panel — sección Estado de servicio', () => {
  it('acepta el estado de servicio como prop opcional', () => {
    expect(panelSource).toContain('export interface ClientServiceStatusView');
    expect(panelSource).toContain('serviceStatus?: ClientServiceStatusView | null');
  });

  it('muestra las 4 dimensiones sin mezclarlas', () => {
    expect(panelSource).toContain('client360-service-status');
    expect(panelSource).toContain('Estado CRM');
    expect(panelSource).toContain('Estado cobranza');
    expect(panelSource).toContain('Estado de servicio');
    expect(panelSource).toContain('Estado en red (router)');
  });
});

describe('CrmModule — integración Service Status', () => {
  it('carga el estado de servicio del cliente abierto y lo pasa al panel', () => {
    expect(crmSource).toContain('/api/service-status/customers/${customerId}');
    expect(crmSource).toContain('serviceStatus={client360ServiceStatus}');
  });

  it('las acciones Suspender/Reactivar llaman a los endpoints de solicitud', () => {
    expect(crmSource).toContain('request-suspension');
    expect(crmSource).toContain('request-reactivation');
  });

  it('comunica que no se ejecutan cambios en MikroTik (estado pendiente)', () => {
    expect(crmSource).toContain('No se ejecutan cambios en MikroTik');
    expect(crmSource).toContain('Estado marcado como pendiente');
  });
});
