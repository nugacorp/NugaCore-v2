// ====================================================================
// NOC Poller routes — status y ciclo manual (READ-ONLY en routers).
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { getNocPollerStatus, runPollCycle } from './service';

const NOC_POLLER_ROLES: AppRole[] = [
  'super admin',
  'administrador',
  'tecnico',
  'soporte',
  'solo lectura',
];

const router = Router();

router.get(
  '/api/noc-poller/status',
  requireRoles(NOC_POLLER_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(getNocPollerStatus());
  }),
);

router.get(
  '/api/noc-poller/run',
  requireRoles(['super admin', 'administrador', 'tecnico']),
  asyncHandler(async (_req, res) => {
    res.json(await runPollCycle());
  }),
);

export default router;
