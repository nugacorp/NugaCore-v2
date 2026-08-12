import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getContractService } from './service';

const router = Router();
const CREATE_DELETE_ROLES = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte'] as const;
const SIGN_ROLES = ['super admin', 'administrador', 'tecnico'] as const;
const VOID_ROLES = ['super admin', 'administrador'] as const;

router.post('/api/contracts', requireRoles([...CREATE_DELETE_ROLES]), asyncHandler(async (req, res) => {
  res.status(201).json(await getContractService().generate(tenantIdFromRequest(req), req.body));
}));

router.get('/api/clients/:clientId/contracts/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getContractService().get(tenantIdFromRequest(req), req.params.id, req.params.clientId));
}));

router.delete('/api/clients/:clientId/contracts/:id', requireRoles([...CREATE_DELETE_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getContractService().deleteDraft(tenantIdFromRequest(req), req.params.id, req.params.clientId));
}));

router.get('/api/clients/:clientId/contracts/:id/evidence', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  await getContractService().get(tenantIdFromRequest(req), req.params.id, req.params.clientId);
  res.json(await getContractService().getEvidence(tenantIdFromRequest(req), req.params.id));
}));

router.post('/api/contracts/:id/sign', requireRoles([...SIGN_ROLES]), asyncHandler(async (req, res) => {
  const auth = req.authContext!;
  const result = await getContractService().sign(tenantIdFromRequest(req), req.params.id, req.body, {
    userId: auth.userId,
    role: auth.role,
    signerIp: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  });
  res.status(result.concurrentAttemptDiscarded ? 409 : 200).json(result);
}));

router.post('/api/contracts/:id/void', requireRoles([...VOID_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getContractService().void(tenantIdFromRequest(req), req.params.id));
}));

export default router;
