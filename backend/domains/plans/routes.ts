import { Router } from 'express';
import { AppRole, READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { PlanRecord } from './mappers';
import { getPlansService } from './service';

const router = Router();

// Persistencia detrás de feature flag USE_DB_PLANS (store mock | Supabase).
// Filtrado obligatorio por tenant (aislamiento multi-WISP).
const WRITE_ROLES: AppRole[] = ['super admin', 'administrador'];

router.get('/api/plans', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const businessType = String(req.query.businessType || '').trim().toLowerCase();
  const tenantId = tenantIdFromRequest(req);

  const rows = await getPlansService().list({ q, status, businessType, tenantId });
  res.json(rows);
}));

router.get('/api/plans/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const plan = await getPlansService().getById(req.params.id, tenantIdFromRequest(req));
  if (!plan) {
    return res.status(404).json({ error: 'Plan not found' });
  }
  res.json(plan);
}));

router.post('/api/plans', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const service = getPlansService();
  const tenantId = tenantIdFromRequest(req);

  const validated = service.validateCreate(req.body);
  await service.assertNameAvailable(validated.name, tenantId);

  const record: PlanRecord = {
    id: await service.generatePlanId(),
    ...validated,
    tenantId,
  };
  const created = await service.create(record);

  res.status(201).json(created);
}));

router.put('/api/plans/:id', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const service = getPlansService();
  const tenantId = tenantIdFromRequest(req);

  const existing = await service.getById(req.params.id, tenantId);
  if (!existing) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  const patch = service.buildUpdatePatch(req.body);
  const updated = await service.update(req.params.id, patch, tenantId);
  if (!updated) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  res.json(updated);
}));

router.delete('/api/plans/:id', requireRoles(WRITE_ROLES), asyncHandler(async (req, res) => {
  const service = getPlansService();
  const tenantId = tenantIdFromRequest(req);

  if (await service.isInUse(req.params.id, tenantId)) {
    return res.status(409).json({ error: 'Plan is in use by at least one client' });
  }

  const removed = await service.remove(req.params.id, tenantId);
  if (!removed) {
    return res.status(404).json({ error: 'Plan not found' });
  }

  res.status(204).send();
}));

export default router;
