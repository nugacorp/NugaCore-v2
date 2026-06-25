// ====================================================================
// Notifications routes (PROD-9) — DRY RUN.
//
// Lectura para todos los roles; crear/simular/cancelar para
// super admin / administrador / cobranza / soporte (FASE N). NO existe
// endpoint de envio real ni de despacho a proveedores reales.
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { notificationService } from './service';

const WRITE_ROLES: AppRole[] = ['super admin', 'administrador', 'cobranza', 'soporte'];
const router = Router();

const actorOf = (req: { authContext?: { userId: string } }): string => req.authContext?.userId ?? 'unknown';

router.get('/api/notifications/templates', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(notificationService.listTemplates());
}));

router.get('/api/notifications/messages', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : '';
  res.json(customerId ? notificationService.messagesForCustomer(customerId) : notificationService.listMessages());
}));

router.get('/api/notifications/messages/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(notificationService.getMessage(req.params.id));
}));

router.get('/api/notifications/summary', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(notificationService.summary());
}));

router.post('/api/notifications/preview', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(notificationService.preview(req.body ?? {}));
}));

router.post('/api/notifications/messages', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.status(201).json(notificationService.createMessage(req.body ?? {}, actorOf(req)));
}));

router.post('/api/notifications/messages/:id/simulate', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(notificationService.simulateMessage(req.params.id, actorOf(req)));
}));

router.post('/api/notifications/messages/:id/cancel', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  res.json(notificationService.cancelMessage(req.params.id, actorOf(req), req.body?.reason));
}));

export default router;
