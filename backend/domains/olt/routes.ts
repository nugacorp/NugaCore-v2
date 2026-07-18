// ====================================================================
// Rutas del dominio OLT: catálogo, CRUD, sugerencia de config y script.
// ====================================================================

import { Router } from 'express';
import { asyncHandler, BadRequestError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { resolveTenantIdForUser, readRequestedTenantId } from '../tenancy/resolve-tenant';
import { getOltService } from './service';
import type { PonType } from './types';

const router = Router();

const WRITE_ROLES = ['super admin', 'administrador', 'tecnico'] as const;

const resolveTenant = async (req: {
  authContext?: { userId?: string; role?: string; source?: 'supabase-jwt' | 'trusted-headers' };
  headers: Record<string, unknown>;
}): Promise<string> =>
  resolveTenantIdForUser({
    userId: req.authContext?.userId ?? '',
    requestedTenantId: readRequestedTenantId(req.headers['x-tenant-id'] as string | string[] | undefined),
    source: req.authContext?.source ?? 'trusted-headers',
  });

// Catálogo de marcas/modelos soportados por el advisor.
router.get('/api/olts/catalog', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(getOltService().catalog());
}));

// Sugerencia de configuración (no persiste): ?brand=&model=&ponType=&mgmtVlan=
router.get('/api/olts/suggest', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const brand = String(req.query.brand || '').trim();
  const model = String(req.query.model || '').trim();
  if (!brand || !model) throw new BadRequestError('brand y model son requeridos');
  const ponType = req.query.ponType ? (String(req.query.ponType) as PonType) : undefined;
  const managementVlan = req.query.mgmtVlan ? Number(req.query.mgmtVlan) : undefined;
  res.json(getOltService().suggest(brand, model, { ponType, managementVlan }));
}));

router.get('/api/olts', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  res.json(await getOltService().list(tenantId));
}));

router.get('/api/olts/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const olt = await getOltService().get(tenantId, req.params.id);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });
  res.json(olt);
}));

router.post('/api/olts', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const brand = String(b.brand || '').trim();
  const model = String(b.model || '').trim();
  const managementIp = String(b.managementIp || b.ip || '').trim();
  if (!name || !brand || !model) throw new BadRequestError('name, brand y model son requeridos');
  if (!managementIp) throw new BadRequestError('managementIp es requerido');
  const olt = await getOltService().create(tenantId, {
    name, brand, model, managementIp,
    ponType: b.ponType,
    managementVlan: b.managementVlan != null ? Number(b.managementVlan) : undefined,
    sshPort: b.sshPort != null ? Number(b.sshPort) : undefined,
    sshUsername: b.sshUsername ? String(b.sshUsername) : undefined,
    towerId: b.towerId ? String(b.towerId) : undefined,
    mikrotikRouterId: b.mikrotikRouterId ? String(b.mikrotikRouterId) : undefined,
    uplinkPort: b.uplinkPort ? String(b.uplinkPort) : undefined,
    notes: b.notes ? String(b.notes) : undefined,
  });
  res.status(201).json(olt);
}));

router.patch('/api/olts/:id', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const b = req.body || {};
  const patch: Record<string, unknown> = {};
  for (const k of ['name', 'sshUsername', 'towerId', 'mikrotikRouterId', 'uplinkPort', 'notes', 'provisioningStatus', 'managementVlan', 'sshPort'] as const) {
    if (b[k] !== undefined) patch[k] = b[k];
  }
  const olt = await getOltService().update(tenantId, req.params.id, patch);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });
  res.json(olt);
}));

router.delete('/api/olts/:id', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const ok = await getOltService().remove(tenantId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'OLT no encontrada' });
  res.status(204).send();
}));

// Script de arranque + snippet MikroTik. El password SSH se devuelve UNA vez.
router.post('/api/olts/:id/script', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const b = req.body || {};
  const result = await getOltService().script(tenantId, req.params.id, {
    wgSubnet: b.wgSubnet ? String(b.wgSubnet) : undefined,
    mikrotikLanIp: b.mikrotikLanIp ? String(b.mikrotikLanIp) : undefined,
    mikrotikLanInterface: b.mikrotikLanInterface ? String(b.mikrotikLanInterface) : undefined,
    mikrotikWgInterface: b.mikrotikWgInterface ? String(b.mikrotikWgInterface) : undefined,
  });
  if (!result) return res.status(404).json({ error: 'OLT no encontrada' });
  res.json(result);
}));

export default router;
