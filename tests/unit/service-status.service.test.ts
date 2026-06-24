import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveServiceStatus,
  listServiceStatuses,
  getServiceStatus,
  getServiceStatusSummary,
  countSuspended,
  requestSuspension,
  requestReactivation,
  ServiceStatusError,
} from '../../backend/domains/service-status/service';
import { serviceStatusStore } from '../../backend/domains/service-status/store';

// ====================================================================
// Unit — Service Status (Pre-PROD-7). Hermético (store en memoria).
// Valida la derivación pura de estados, las transiciones (dryRun) y que el
// dominio NO ejecuta cambios reales (solo marca pendiente + audita).
// ====================================================================

beforeEach(() => serviceStatusStore.reset());

describe('deriveServiceStatus — derivación pura', () => {
  it('baja → CANCELLED', () => {
    expect(deriveServiceStatus({ customerStatus: 'baja', billingStatus: 'CURRENT', pendingRequest: null }).status).toBe('CANCELLED');
  });

  it('lead → PENDING_INSTALL', () => {
    expect(deriveServiceStatus({ customerStatus: 'lead', billingStatus: 'CURRENT', pendingRequest: null }).status).toBe('PENDING_INSTALL');
  });

  it('active + CURRENT → ACTIVE', () => {
    expect(deriveServiceStatus({ customerStatus: 'active', billingStatus: 'CURRENT', pendingRequest: null }).status).toBe('ACTIVE');
  });

  it('active + OVERDUE → SUSPENSION_PENDING', () => {
    expect(deriveServiceStatus({ customerStatus: 'active', billingStatus: 'OVERDUE', pendingRequest: null }).status).toBe('SUSPENSION_PENDING');
  });

  it('suspended + OVERDUE → SUSPENDED', () => {
    expect(deriveServiceStatus({ customerStatus: 'suspended', billingStatus: 'OVERDUE', pendingRequest: null }).status).toBe('SUSPENDED');
  });

  it('suspended + CURRENT (pago recibido) → REACTIVATION_PENDING', () => {
    expect(deriveServiceStatus({ customerStatus: 'suspended', billingStatus: 'CURRENT', pendingRequest: null }).status).toBe('REACTIVATION_PENDING');
  });

  it('overlay de suspensión tiene prioridad sobre la derivación de cobranza', () => {
    expect(deriveServiceStatus({ customerStatus: 'active', billingStatus: 'CURRENT', pendingRequest: 'suspension' }).status).toBe('SUSPENSION_PENDING');
  });

  it('overlay de reactivación tiene prioridad', () => {
    expect(deriveServiceStatus({ customerStatus: 'suspended', billingStatus: 'OVERDUE', pendingRequest: 'reactivation' }).status).toBe('REACTIVATION_PENDING');
  });
});

describe('listServiceStatuses / summary — sobre la data semilla', () => {
  it('clasifica los clientes semilla por estado oficial', async () => {
    const summary = await getServiceStatusSummary();
    // c-1/c-2/c-3 activos al corriente; c-4 suspendido+vencido; c-5 activo+vencido; 2 leads.
    expect(summary.byStatus.ACTIVE).toBe(3);
    expect(summary.byStatus.SUSPENDED).toBe(1);
    expect(summary.byStatus.SUSPENSION_PENDING).toBe(1);
    expect(summary.byStatus.PENDING_INSTALL).toBe(2);
    expect(summary.total).toBe(summary.byStatus.ACTIVE + summary.byStatus.SUSPENDED + summary.byStatus.SUSPENSION_PENDING + summary.byStatus.PENDING_INSTALL + summary.byStatus.REACTIVATION_PENDING + summary.byStatus.CANCELLED);
  });

  it('countSuspended es el conteo oficial del KPI Suspendidos', async () => {
    expect(await countSuspended()).toBe((await getServiceStatusSummary()).byStatus.SUSPENDED);
  });

  it('cada vista distingue las 4 dimensiones sin mezclarlas', async () => {
    const views = await listServiceStatuses();
    const c4 = views.find((v) => v.customerId === 'c-4');
    expect(c4).toBeTruthy();
    expect(c4!.customerStatus).toBe('suspended');
    expect(c4!.billingStatus).toBe('OVERDUE');
    expect(c4!.serviceStatus).toBe('SUSPENDED');
    expect(c4!.routerStatus).toBeNull();
  });
});

describe('requestSuspension / requestReactivation — dryRun, sin ejecución', () => {
  it('suspensión marca SUSPENSION_PENDING sin cambiar el customerStatus del CRM', async () => {
    const before = await getServiceStatus('c-1');
    expect(before!.serviceStatus).toBe('ACTIVE');

    const { view, event } = await requestSuspension('c-1', 'prueba', 'cobranza');
    expect(view.serviceStatus).toBe('SUSPENSION_PENDING');
    expect(view.customerStatus).toBe('active'); // CRM intacto
    expect(event.dryRun).toBe(true);
    expect(event.previousStatus).toBe('ACTIVE');
    expect(event.nextStatus).toBe('SUSPENSION_PENDING');
  });

  it('reactivación marca REACTIVATION_PENDING', async () => {
    const { view } = await requestReactivation('c-4', 'pago', 'administrador');
    expect(view.serviceStatus).toBe('REACTIVATION_PENDING');
  });

  it('rechaza clientes no serviceables (lead) con 409', async () => {
    await expect(requestSuspension('c-lead-1', '', 'cobranza')).rejects.toMatchObject({
      code: 'NOT_SERVICEABLE',
      httpStatus: 409,
    });
  });

  it('rechaza cliente inexistente con 404', async () => {
    await expect(requestSuspension('nope', '', 'cobranza')).rejects.toBeInstanceOf(ServiceStatusError);
  });
});
