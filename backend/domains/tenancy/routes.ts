import { Router } from 'express';
import { asyncHandler, BadRequestError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getTenancyService } from './service';

const router = Router();

const ADMIN_ROLES = ['super admin', 'administrador'] as const;

router.get('/api/tenancy/status', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(getTenancyService().status());
}));

router.get('/api/tenants', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const service = getTenancyService();
  const all = await service.listTenants();
  const userId = req.authContext?.userId;
  if (!userId) {
    res.json(all);
    return;
  }
  // En multi-tenant, listar solo tenants donde el usuario es miembro
  // (super admin / administrador ven todos).
  const role = req.authContext?.role;
  if (role === 'super admin' || role === 'administrador') {
    res.json(all);
    return;
  }
  const memberships = await service.listMembershipsForUser(userId);
  const allowed = new Set(memberships.map((m) => m.tenantId));
  if (allowed.size === 0) {
    res.json(all.filter((t) => t.id === service.status().defaultTenantId));
    return;
  }
  res.json(all.filter((t) => allowed.has(t.id)));
}));

router.get('/api/tenants/default', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getTenancyService().getDefaultTenant());
}));

router.get('/api/tenants/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenant = await getTenancyService().getTenant(req.params.id);
  if (!tenant) {
    return res.status(404).json({ error: 'Tenant not found' });
  }
  res.json(tenant);
}));

router.post('/api/tenants', requireRoles([...ADMIN_ROLES]), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const tenant = await getTenancyService().createTenant({
    name: String(body.name || ''),
    slug: String(body.slug || ''),
    status: body.status,
    ownerUserId: body.ownerUserId ? String(body.ownerUserId) : req.authContext?.userId,
  });
  res.status(201).json(tenant);
}));

router.get('/api/tenancy/memberships', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const userId = String(req.query.userId || req.authContext?.userId || '').trim();
  if (!userId) {
    throw new BadRequestError('userId required', 'MISSING_FIELD');
  }
  // Solo el propio usuario o admin puede listar membresías ajenas.
  const role = req.authContext?.role;
  if (
    userId !== req.authContext?.userId
    && role !== 'super admin'
    && role !== 'administrador'
  ) {
    return res.status(403).json({ error: 'Forbidden: cannot list other user memberships' });
  }
  res.json(await getTenancyService().listMembershipsForUser(userId));
}));

router.get(
  '/api/tenants/:id/memberships',
  requireRoles([...ADMIN_ROLES]),
  asyncHandler(async (req, res) => {
    res.json(await getTenancyService().listMembershipsForTenant(req.params.id));
  }),
);

router.post(
  '/api/tenants/:id/memberships',
  requireRoles([...ADMIN_ROLES]),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const membership = await getTenancyService().ensureMembership({
      tenantId: req.params.id,
      userId: String(body.userId || ''),
      role: body.role,
      status: body.status,
    });
    res.status(201).json(membership);
  }),
);

router.delete(
  '/api/tenancy/memberships/:id',
  requireRoles([...ADMIN_ROLES]),
  asyncHandler(async (req, res) => {
    const ok = await getTenancyService().removeMembership(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Membership not found' });
    res.status(204).send();
  }),
);

export default router;
