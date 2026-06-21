// ====================================================================
// Rutas Manual Safe Mode (PROD-1) — READ + transiciones de estado SEGURAS.
//
// NINGÚN endpoint ejecuta RouterOS, WireGuard, billing, suspensión, shell
// ni workers. Todo es mock seguro sobre store en memoria.
//
// RBAC:
//   ver / crear / aprobar / rechazar / simular / cancelar:
//     super admin, administrador, tecnico, soporte, solo lectura
//   Cobranza: 403
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { manualSafeModeService } from './service';

const SAFE_MODE_ROLES: AppRole[] = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'];

const router = Router();

const actorOf = (req: { authContext?: { userId: string } }): string => req.authContext?.userId ?? 'unknown';

router.get(
  '/api/manual-actions',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(manualSafeModeService.listActions());
  }),
);

router.get(
  '/api/manual-actions/:id',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(manualSafeModeService.getAction(req.params.id));
  }),
);

router.post(
  '/api/manual-actions',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (req, res) => {
    const action = manualSafeModeService.createAction(req.body ?? {}, actorOf(req));
    res.status(201).json(action);
  }),
);

router.post(
  '/api/manual-actions/:id/approve',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(manualSafeModeService.approveAction(req.params.id, actorOf(req)));
  }),
);

router.post(
  '/api/manual-actions/:id/reject',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    res.json(manualSafeModeService.rejectAction(req.params.id, actorOf(req), reason));
  }),
);

router.post(
  '/api/manual-actions/:id/simulate',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(manualSafeModeService.simulateAction(req.params.id, actorOf(req)));
  }),
);

router.post(
  '/api/manual-actions/:id/cancel',
  requireRoles(SAFE_MODE_ROLES),
  asyncHandler(async (req, res) => {
    res.json(manualSafeModeService.cancelAction(req.params.id, actorOf(req)));
  }),
);

export default router;
