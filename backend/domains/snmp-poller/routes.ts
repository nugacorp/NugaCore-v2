// ====================================================================
// SNMP Poller routes — health, targets, telemetría y ciclo manual.
//
// Todos los endpoints quedan segmentados por tenant (aislamiento multi-WISP):
// cada WISP solo ve la telemetría de sus propios routers, nunca mezclada.
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import {
  buildSnmpTargets,
  getSnmpPollerStatusForTenant,
  getSnmpTelemetryForTenant,
  runPollCycle,
} from './service';

const SNMP_READ_ROLES: AppRole[] = [
  'super admin',
  'administrador',
  'tecnico',
  'soporte',
  'solo lectura',
];

const router = Router();

router.get(
  '/api/snmp/health',
  requireRoles(SNMP_READ_ROLES),
  asyncHandler(async (req, res) => {
    res.json(await getSnmpPollerStatusForTenant(tenantIdFromRequest(req)));
  }),
);

router.get(
  '/api/snmp/targets',
  requireRoles(SNMP_READ_ROLES),
  asyncHandler(async (req, res) => {
    const targets = await buildSnmpTargets(tenantIdFromRequest(req));
    res.json({
      total: targets.length,
      targets: targets.map((t) => ({
        id: t.id,
        routerId: t.routerId,
        name: t.name,
        host: t.host,
        port: t.port,
        version: t.version,
        zoneId: t.zoneId,
      })),
    });
  }),
);

router.get(
  '/api/snmp/telemetry',
  requireRoles(SNMP_READ_ROLES),
  asyncHandler(async (req, res) => {
    res.json(await getSnmpTelemetryForTenant(tenantIdFromRequest(req)));
  }),
);

router.get(
  '/api/snmp/run',
  requireRoles(['super admin', 'administrador', 'tecnico']),
  asyncHandler(async (req, res) => {
    res.json(await runPollCycle(tenantIdFromRequest(req)));
  }),
);

export default router;
