// ====================================================================
// SNMP Poller routes — health, targets y ciclo manual.
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import {
  buildSnmpTargets,
  getSnmpPollerStatus,
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
  asyncHandler(async (_req, res) => {
    res.json(getSnmpPollerStatus());
  }),
);

router.get(
  '/api/snmp/targets',
  requireRoles(SNMP_READ_ROLES),
  asyncHandler(async (_req, res) => {
    const targets = await buildSnmpTargets();
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
  '/api/snmp/run',
  requireRoles(['super admin', 'administrador', 'tecnico']),
  asyncHandler(async (_req, res) => {
    res.json(await runPollCycle());
  }),
);

export default router;
