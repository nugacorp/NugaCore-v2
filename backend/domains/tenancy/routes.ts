import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getTenancyService } from './service';

const router = Router();

router.get('/api/tenancy/status', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(getTenancyService().status());
}));

router.get('/api/tenants', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getTenancyService().listTenants());
}));

router.get('/api/tenants/default', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getTenancyService().getDefaultTenant());
}));

export default router;
