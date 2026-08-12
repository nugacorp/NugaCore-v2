import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { BILLING_READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getFinanceOperationalService } from './service';

const router = Router();
const WRITE = ['super admin', 'administrador', 'cobranza'] as const;

router.get('/api/finance/operational/expenses', requireRoles(BILLING_READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getFinanceOperationalService().listExpenses({
    category: req.query.category ? String(req.query.category) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    tenantId: tenantIdFromRequest(req),
  }));
}));

router.post('/api/finance/operational/expenses', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const created = await getFinanceOperationalService().createExpense(
    req.body || {},
    req.authContext?.userId,
    tenantIdFromRequest(req),
  );
  res.status(201).json(created);
}));

router.delete('/api/finance/operational/expenses/:id', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const { id } = req.params;
  await getFinanceOperationalService().deleteExpense(String(id), tenantIdFromRequest(req));
  res.status(204).send();
}));

router.get('/api/finance/operational/pnl', requireRoles(BILLING_READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getFinanceOperationalService().getOperationalPnl(
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined,
    tenantIdFromRequest(req),
  ));
}));

router.get('/api/finance/cfdi/status', requireRoles(BILLING_READ_ROLES), asyncHandler(async (_req, res) => {
  res.json({
    enabled: false,
    provider: null,
    mode: 'stub',
    message: 'Integración PAC CFDI pendiente — ver ROADMAP Fase 4.9.',
    supportedReceipts: ['pdf', 'spei_reference'],
    timbrado: false,
  });
}));

export default router;
