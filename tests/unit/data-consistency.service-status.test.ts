import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { runDataConsistencyCheck } from '../../backend/domains/system/consistency';
import { countSuspended, requestReactivation } from '../../backend/domains/service-status/service';
import { serviceStatusStore } from '../../backend/domains/service-status/store';

// ====================================================================
// Unit — Data Consistency × Service Status (Pre-PROD-7).
// El KPI "Suspendidos" debe tener a Service Status como fuente oficial, y el
// dashboard debe coincidir con ella (single source of truth).
// ====================================================================

beforeEach(() => serviceStatusStore.reset());
afterAll(() => serviceStatusStore.reset());

describe('auditor — Suspendidos desde Service Status', () => {
  it('la métrica suspendedCustomers declara ServiceStatus como fuente oficial', async () => {
    const report = await runDataConsistencyCheck();
    const check = report.checks.find((c) => c.metric === 'suspendedCustomers');
    expect(check).toBeTruthy();
    expect(check!.source).toBe('ServiceStatus');
    expect(check!.official).toBe(await countSuspended());
    expect(check!.consistent).toBe(true);
  });

  it('ServiceStatus aparece como módulo auditado y el reporte queda healthy', async () => {
    const report = await runDataConsistencyCheck();
    expect(report.modules).toContain('ServiceStatus');
    expect(report.healthy).toBe(true);
  });

  it('al regularizar un suspendido, dashboard y fuente oficial bajan JUNTOS (sin divergir)', async () => {
    expect(await countSuspended()).toBe(1);
    // Solicitar reactivación de c-4 lo saca de SUSPENDED → REACTIVATION_PENDING.
    await requestReactivation('c-4', 'pago aplicado', 'cobranza');
    expect(await countSuspended()).toBe(0);

    const report = await runDataConsistencyCheck();
    const check = report.checks.find((c) => c.metric === 'suspendedCustomers');
    expect(check!.official).toBe(0);
    expect(check!.consumers.dashboard).toBe(0);
    expect(report.healthy).toBe(true);
  });
});
