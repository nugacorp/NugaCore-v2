import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getFinanceOperationalService } from './service';

const router = Router();
const WRITE = ['super admin', 'administrador', 'cobranza'] as const;

router.get('/api/finance/operational/expenses', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(getFinanceOperationalService().listExpenses({
    category: req.query.category ? String(req.query.category) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
  }));
}));

router.post('/api/finance/operational/expenses', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const created = await getFinanceOperationalService().createExpense(req.body || {}, req.authContext?.userId);
  res.status(201).json(created);
}));

router.get('/api/finance/operational/pnl', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getFinanceOperationalService().getOperationalPnl(
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined,
  ));
}));

export default router;
