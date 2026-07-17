import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getCollectionsService } from './service';

const router = Router();
const WRITE = ['super admin', 'administrador', 'cobranza'] as const;

router.get('/api/collections/promises', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getCollectionsService().listPromises({
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    tenantId: tenantIdFromRequest(req),
  }));
}));

router.post('/api/collections/promises', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  res.status(201).json(await getCollectionsService().createPromise(
    req.body || {},
    req.authContext?.userId,
    tenantIdFromRequest(req),
  ));
}));

router.post('/api/collections/promises/:id/fulfill', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  res.json(await getCollectionsService().fulfillPromise(req.params.id, tenantIdFromRequest(req)));
}));

router.get('/api/collections/cash-register', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getCollectionsService().getCashRegisterSummary(
    req.query.date ? String(req.query.date) : undefined,
    tenantIdFromRequest(req),
  ));
}));

router.post('/api/collections/cash-register/entries', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  res.status(201).json(await getCollectionsService().addCashEntry(req.body || {}, {
    id: req.authContext?.userId,
    name: req.authContext?.role,
  }, tenantIdFromRequest(req)));
}));

export default router;
