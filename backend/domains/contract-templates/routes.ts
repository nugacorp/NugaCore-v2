import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getContractTemplateService } from './service';

const router = Router();
const WRITE_ROLES = ['super admin', 'administrador'] as const;

router.get('/api/contract-template/variables', requireRoles(READ_ROLES), (req, res) => {
  res.json({ tenantId: tenantIdFromRequest(req), variables: getContractTemplateService().listVariables() });
});

router.get('/api/contract-template', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getContractTemplateService().getTemplate(tenantIdFromRequest(req)));
}));

router.put('/api/contract-template', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getContractTemplateService().saveTemplate(tenantIdFromRequest(req), req.body));
}));

export default router;
