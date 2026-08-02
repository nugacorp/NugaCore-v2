// ====================================================================
// Rutas del dominio OLT: catálogo, CRUD, sugerencia de config y script.
// ====================================================================

import { Router } from 'express';
import { asyncHandler, BadRequestError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { resolveTenantIdForUser, readRequestedTenantId } from '../tenancy/resolve-tenant';
import { getOltService } from './service';
import { getOltActionsService, OltNotFoundError, OLT_EXECUTION_ENABLED } from './actions/service';
import { isOltActionType, type OnuActionPayload } from './command-builder';
import { getOltCredentialsService } from './credentials';
import type { PonType } from './types';
import type { OltActionStatus } from './actions/types';

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

// ── Cola de acciones ──────────────────────────────────────────────────

router.get('/api/olt-actions', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const actions = await getOltActionsService().list(tenantId, {
    oltId: req.query.oltId ? String(req.query.oltId) : undefined,
    customerId: req.query.customerId ? String(req.query.customerId) : undefined,
    status: req.query.status ? (String(req.query.status) as OltActionStatus) : undefined,
  });
  res.json({ executionEnabled: OLT_EXECUTION_ENABLED, actions });
}));

router.get('/api/olt-actions/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const action = await getOltActionsService().get(tenantId, req.params.id);
  if (!action) return res.status(404).json({ error: 'Acción no encontrada' });
  res.json(action);
}));

/**
 * Encola una acción hacia la OLT. Siempre dry-run: se registra el plan de
 * comandos para revisión, nadie lo ejecuta (OLT_EXECUTION_ENABLED = false).
 */
router.post('/api/olt-actions', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const b = req.body || {};
  const oltId = String(b.oltId || '').trim();
  if (!oltId) throw new BadRequestError('oltId es requerido');
  if (!isOltActionType(b.actionType)) {
    throw new BadRequestError('actionType inválido');
  }

  try {
    const action = await getOltActionsService().enqueue(tenantId, {
      oltId,
      actionType: b.actionType,
      payload: (b.payload as OnuActionPayload) ?? {},
      customerId: b.customerId ? String(b.customerId) : undefined,
      onuId: b.onuId ? String(b.onuId) : undefined,
      triggeredBy: req.authContext?.userId,
    });
    res.status(201).json(action);
  } catch (error) {
    if (error instanceof OltNotFoundError) {
      return res.status(404).json({ error: error.message, code: 'OLT_NOT_FOUND' });
    }
    throw error;
  }
}));

router.post('/api/olt-actions/:id/cancel', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const reason = req.body?.reason ? String(req.body.reason) : undefined;
  const action = await getOltActionsService().cancel(tenantId, req.params.id, reason);
  if (!action) return res.status(404).json({ error: 'Acción no encontrada' });
  res.json(action);
}));

// ── Credenciales SSH (cifradas; el password nunca se devuelve) ─────────

router.get('/api/olts/:id/credentials', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const olt = await getOltService().get(tenantId, req.params.id);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });
  const meta = await getOltCredentialsService().getMeta(tenantId, req.params.id);
  res.json(meta ?? { oltId: req.params.id, hasPassword: false });
}));

router.put('/api/olts/:id/credentials', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const tenantId = await resolveTenant(req);
  const olt = await getOltService().get(tenantId, req.params.id);
  if (!olt) return res.status(404).json({ error: 'OLT no encontrada' });

  const b = req.body || {};
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!username) throw new BadRequestError('username es requerido');
  if (password.length < 8) {
    throw new BadRequestError('password es requerido (mínimo 8 caracteres)');
  }

  const meta = await getOltCredentialsService().set(tenantId, req.params.id, username, password);
  res.status(201).json(meta);
}));

export default router;
