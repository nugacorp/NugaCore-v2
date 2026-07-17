import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getClient360Service } from './service';

const router = Router();
const WRITE = ['super admin', 'administrador', 'soporte', 'cobranza', 'tecnico'] as const;
const svc = () => getClient360Service();

router.get('/api/clients/:clientId/expediente', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().getExpediente(req.params.clientId, tenantId));
}));

router.get('/api/clients/:clientId/tags', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().listTags(req.params.clientId, tenantId));
}));

router.post('/api/clients/:clientId/tags', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  const created = await svc().addTag(
    req.params.clientId,
    tenantId,
    String(req.body?.label || ''),
    req.body?.color ? String(req.body.color) : undefined,
  );
  res.status(201).json(created);
}));

router.delete('/api/clients/:clientId/tags/:tagId', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().removeTag(req.params.clientId, tenantId, req.params.tagId));
}));

router.get('/api/clients/:clientId/contacts', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().listContacts(req.params.clientId, tenantId));
}));

router.post('/api/clients/:clientId/contacts', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.status(201).json(await svc().addContact(req.params.clientId, tenantId, req.body || {}));
}));

router.get('/api/clients/:clientId/documents', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(await svc().listDocuments(req.params.clientId, tenantId));
}));

router.post('/api/clients/:clientId/documents', requireRoles([...WRITE]), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.status(201).json(await svc().addDocument(req.params.clientId, tenantId, req.body || {}, req.authContext?.userId));
}));

router.get('/api/clients/:clientId/activity', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  res.json(await svc().listActivity(req.params.clientId, tenantId, limit));
}));

export default router;
