import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { ipamService } from './service';

const router = Router();

router.get(
  '/api/ipam/routers',
  requireRoles(READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await ipamService.listRouters());
  }),
);

router.get(
  '/api/ipam/routers/:routerId/pools',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const pools = await ipamService.listPools(req.params.routerId);
    if (!pools) {
      return res.status(404).json({ error: 'IPAM router not found', code: 'IPAM_ROUTER_NOT_FOUND' });
    }
    res.json(pools);
  }),
);

router.get(
  '/api/ipam/routers/:routerId/capacity',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const capacity = await ipamService.capacity(req.params.routerId);
    if (!capacity) {
      return res.status(404).json({ error: 'IPAM router not found', code: 'IPAM_ROUTER_NOT_FOUND' });
    }
    res.json(capacity);
  }),
);

router.get(
  '/api/ipam/pools/:poolId/available-ips',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const result = await ipamService.availableIps(req.params.poolId);
    if (!result) {
      return res.status(404).json({ error: 'IPAM pool not found', code: 'IPAM_POOL_NOT_FOUND' });
    }
    res.json(result);
  }),
);

router.post(
  '/api/ipam/validate-ip',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const result = await ipamService.validateIp({
      routerId: String(req.body?.routerId || ''),
      poolId: String(req.body?.poolId || ''),
      ip: String(req.body?.ip || ''),
    });
    res.json(result);
  }),
);

export default router;
