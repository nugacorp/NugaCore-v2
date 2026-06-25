import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { provisioningService } from './service';

const WRITE_ROLES: AppRole[] = ['super admin', 'administrador', 'cobranza'];
const router = Router();

const actorOf = (req: { authContext?: { userId: string } }): string => req.authContext?.userId ?? 'unknown';

router.get('/api/provisioning/actions', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(provisioningService.listActions());
}));

router.get('/api/provisioning/actions/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(provisioningService.getAction(req.params.id));
}));

router.get('/api/provisioning/summary', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(provisioningService.summary());
}));

router.post('/api/provisioning/actions', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(provisioningService.createAction(req.body ?? {}, actorOf(req)));
}));

router.post('/api/provisioning/actions/:id/validate', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(provisioningService.validateAction(req.params.id, actorOf(req)));
}));

router.post('/api/provisioning/actions/:id/simulate', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(provisioningService.simulateAction(req.params.id, actorOf(req)));
}));

router.post('/api/provisioning/actions/:id/approve', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(provisioningService.approveAction(req.params.id, actorOf(req)));
}));

router.post('/api/provisioning/actions/:id/reject', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(provisioningService.rejectAction(req.params.id, actorOf(req), req.body?.reason));
}));

router.post('/api/provisioning/actions/:id/cancel', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(provisioningService.cancelAction(req.params.id, actorOf(req)));
}));

export default router;
