import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { getCustomersService, parseClientStatus } from '../customers/service';
import { getNetworkService } from '../network/service';
import { buildGisMapData } from './service';
const router = Router();

router.get('/api/gis/health', requireRoles(READ_ROLES), (_req, res) => {
  res.json({ status: 'ok', mode: 'store-backed-v2', note: 'Datos SSOT via services segun USE_DB_*' });
});

router.get('/api/gis/layers', requireRoles(READ_ROLES), (_req, res) => {
  res.json([
    { id: 'towers', label: 'Torres WISP', enabled: true },
    { id: 'clients', label: 'Clientes', enabled: true },
    { id: 'naps', label: 'NAPs FTTH', enabled: true },
    { id: 'onus', label: 'ONUs', enabled: true },
    { id: 'olts', label: 'OLTs', enabled: true },
  ]);
});

router.get('/api/gis/map-data', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await buildGisMapData({
    status: req.query.status ? String(req.query.status) : undefined,
    planId: req.query.planId ? String(req.query.planId) : undefined,
    towerId: req.query.towerId ? String(req.query.towerId) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
  }));
}));

router.get('/api/gis/customers', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const rows = await getCustomersService().list({
    status: parseClientStatus(req.query.status) ?? undefined,
    planId: req.query.planId ? String(req.query.planId) : undefined,
  });
  res.json(rows);
}));

router.get('/api/gis/towers', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const rows = await getNetworkService().listTowers({
    status: req.query.status ? String(req.query.status) : undefined,
  });
  res.json(rows);
}));

export default router;
