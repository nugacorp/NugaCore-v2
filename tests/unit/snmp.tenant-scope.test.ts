// ====================================================================
// SNMP poller — aislamiento multi-tenant (cada WISP ve solo lo suyo).
//
// Verifica que la construcción de targets y la telemetría queden
// estrictamente segmentadas por tenant: enrollments y routers de un WISP
// nunca deben aparecer en la vista de otro.
// ====================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../backend/state/store';
import { encryptSecret } from '../../backend/services/crypto';
import { enrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import type { RouterEnrollmentRecord } from '../../backend/domains/router-enrollment/types';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';
import {
  buildSnmpTargets,
  getSnmpTelemetryForTenant,
  runPollCycle,
  getSnmpPollerStatusForTenant,
  _resetSnmpPollerForTests,
} from '../../backend/domains/snmp-poller/service';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const makeRouter = (id: string, tenantId: string): MikrotikRouterRegistryItem =>
  ({
    id,
    name: `router-${id}`,
    tenantId,
    ipAddress: '10.0.0.1',
    apiPort: 8728,
    username: 'admin',
    encryptedPassword: encryptSecret('pw'),
    isOnline: true,
    cpuUsagePct: 1,
    memoryUsagePct: 1,
    routerOsVersion: '7',
    lastHealthCheckAt: new Date().toISOString(),
    vpnIp: '10.70.1.2/32',
  }) as MikrotikRouterRegistryItem;

const makeEnrollment = (
  id: string,
  routerId: string,
  tenantId: string,
): RouterEnrollmentRecord =>
  ({
    id,
    tenantId,
    routerId,
    wgServerId: 'wg-1',
    wgPeerId: `peer-${id}`,
    enrolledBy: 'tester',
    status: 'online',
    routerosVersion: '7',
    templateId: 'nugacore_factory_onboarding',
    checkOnlineAttempts: 0,
    snmpSnapshot: { encryptedCommunity: encryptSecret(`community-${tenantId}`) },
  }) as RouterEnrollmentRecord;

describe('SNMP multi-tenant isolation', () => {
  const savedRouters = [...store.MIKROTIK_ROUTERS];

  beforeEach(() => {
    enrollmentRepository._reset();
    _resetSnmpPollerForTests();
    store.MIKROTIK_ROUTERS.length = 0;
    store.MIKROTIK_ROUTERS.push(makeRouter('ra', TENANT_A), makeRouter('rb', TENANT_B));
    enrollmentRepository.create(makeEnrollment('enr-a', 'ra', TENANT_A));
    enrollmentRepository.create(makeEnrollment('enr-b', 'rb', TENANT_B));
  });

  afterEach(() => {
    enrollmentRepository._reset();
    _resetSnmpPollerForTests();
    store.MIKROTIK_ROUTERS.length = 0;
    store.MIKROTIK_ROUTERS.push(...savedRouters);
  });

  it('buildSnmpTargets(tenant) devuelve solo los routers de ese WISP', async () => {
    const targetsA = await buildSnmpTargets(TENANT_A);
    expect(targetsA.map((t) => t.routerId)).toEqual(['ra']);

    const targetsB = await buildSnmpTargets(TENANT_B);
    expect(targetsB.map((t) => t.routerId)).toEqual(['rb']);
  });

  it('no incluye un enrollment cuyo router pertenece a otro tenant (guard cruzado)', async () => {
    // Enrollment mal etiquetado como tenant-A pero apuntando al router de tenant-B.
    enrollmentRepository.create(makeEnrollment('enr-x', 'rb', TENANT_A));
    const targetsA = await buildSnmpTargets(TENANT_A);
    expect(targetsA.map((t) => t.routerId)).toEqual(['ra']);
  });

  it('getSnmpTelemetryForTenant devuelve solo el WISP y sin exponer la community', async () => {
    const telemetryA = await getSnmpTelemetryForTenant(TENANT_A);
    expect(telemetryA.routers.map((r) => r.routerId)).toEqual(['ra']);
    const serialized = JSON.stringify(telemetryA);
    expect(serialized).not.toMatch(/community/i);
    expect(serialized).not.toMatch(/encryptedCommunity/);
  });

  it('un routerId reutilizado por otro tenant NO hereda la caché del anterior', async () => {
    // WISP A tiene un router con id compartido y una muestra en caché.
    const sharedId = 'mkt-reused';
    store.MIKROTIK_ROUTERS.length = 0;
    const routerA = makeRouter(sharedId, TENANT_A);
    routerA.name = 'Router del WISP A';
    store.MIKROTIK_ROUTERS.push(routerA);
    enrollmentRepository._reset();
    enrollmentRepository.create(makeEnrollment('enr-a', sharedId, TENANT_A));
    await runPollCycle(TENANT_A); // puebla la caché tenant-a::mkt-reused

    // El router se borra y el id se recicla para el WISP B (mismo id, otro dueño).
    store.MIKROTIK_ROUTERS.length = 0;
    const routerB = makeRouter(sharedId, TENANT_B);
    routerB.name = 'Router del WISP B';
    store.MIKROTIK_ROUTERS.push(routerB);
    enrollmentRepository._reset();
    enrollmentRepository.create(makeEnrollment('enr-b', sharedId, TENANT_B));

    const telemetryB = await getSnmpTelemetryForTenant(TENANT_B);
    expect(telemetryB.routers).toHaveLength(1);
    // Nunca debe aparecer el nombre/muestra del WISP A bajo el id reciclado.
    expect(telemetryB.routers[0].name).toBe('Router del WISP B');
    expect(telemetryB.routers[0].source).toBe('pending');
  });

  it('getSnmpPollerStatusForTenant recorta lastCycle por tenant autoritativo', async () => {
    // Un ciclo GLOBAL puebla lastCycle con un resultado del WISP A.
    store.MIKROTIK_ROUTERS.length = 0;
    store.MIKROTIK_ROUTERS.push(makeRouter('ra', TENANT_A));
    enrollmentRepository._reset();
    enrollmentRepository.create(makeEnrollment('enr-a', 'ra', TENANT_A));
    await runPollCycle(); // sin tenant → fija lastCycle global

    const statusA = await getSnmpPollerStatusForTenant(TENANT_A);
    expect(statusA.lastCycle?.results ?? []).toHaveLength(1);

    // El WISP B no debe ver el resultado del WISP A.
    const statusB = await getSnmpPollerStatusForTenant(TENANT_B);
    expect(statusB.lastCycle?.results ?? []).toHaveLength(0);
  });
});
