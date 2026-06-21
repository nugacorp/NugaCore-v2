// ====================================================================
// Rutas Safe Command Queue (FAST-1, dry-run) — transiciones SEGURAS.
//
// NINGÚN endpoint ejecuta RouterOS, MikroTik API, WireGuard, shell ni
// workers. NO existe endpoint /execute. Mismo RBAC que el resto de SAFE:
// Cobranza queda excluido (403).
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { safeCommandQueueService } from './service';

const SAFE_QUEUE_ROLES: AppRole[] = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'];

const router = Router();

const actorOf = (req: { authContext?: { userId: string } }): string => req.authContext?.userId ?? 'unknown';

router.get(
  '/api/safe-command-queue',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(safeCommandQueueService.listCommands());
  }),
);

router.get(
  '/api/safe-command-queue/:id',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(safeCommandQueueService.getCommand(req.params.id));
  }),
);

router.post(
  '/api/safe-command-queue',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    const command = safeCommandQueueService.createCommand(req.body ?? {}, actorOf(req));
    res.status(201).json(command);
  }),
);

router.post(
  '/api/safe-command-queue/:id/validate',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(safeCommandQueueService.validateCommand(req.params.id, actorOf(req)));
  }),
);

router.post(
  '/api/safe-command-queue/:id/simulate',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(safeCommandQueueService.simulateCommand(req.params.id, actorOf(req)));
  }),
);

router.post(
  '/api/safe-command-queue/:id/approve',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(safeCommandQueueService.approveCommand(req.params.id, actorOf(req)));
  }),
);

router.post(
  '/api/safe-command-queue/:id/reject',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    res.json(safeCommandQueueService.rejectCommand(req.params.id, actorOf(req), reason));
  }),
);

router.post(
  '/api/safe-command-queue/:id/cancel',
  requireRoles(SAFE_QUEUE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(safeCommandQueueService.cancelCommand(req.params.id, actorOf(req)));
  }),
);

export default router;
