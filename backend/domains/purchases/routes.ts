import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getPurchasesService } from './service';

const router = Router();
const WRITE = ['super admin', 'administrador'] as const;

router.get('/api/purchases/suppliers', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(getPurchasesService().listSuppliers());
}));

router.post('/api/purchases/suppliers', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  res.status(201).json(getPurchasesService().createSupplier(req.body || {}));
}));

router.get('/api/purchases/orders', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(getPurchasesService().listOrders());
}));

router.post('/api/purchases/orders', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  res.status(201).json(await getPurchasesService().createOrder(req.body || {}));
}));

router.post('/api/purchases/orders/:id/receive', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  res.json(getPurchasesService().receiveOrder(req.params.id));
}));

export default router;
