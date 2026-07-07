import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getRadiusService } from './service';

const router = Router();

router.get('/api/radius/status', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(getRadiusService().status());
}));

router.get('/api/radius/sessions', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const limit = Math.min(100, Number(req.query.limit) || 50);
  res.json(await getRadiusService().listSessions(limit));
}));

export default router;
