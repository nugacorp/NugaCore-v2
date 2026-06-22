import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { coverageService } from './service';

const router = Router();

router.get(
  '/api/coverage/check',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const routerId = String(req.query.routerId || '').trim();
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    if (!routerId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        error: 'routerId, latitude and longitude are required',
        code: 'COVERAGE_INPUT_INVALID',
      });
    }

    try {
      const result = await coverageService.check({ routerId, latitude, longitude });
      if (!result) {
        return res.status(404).json({
          error: 'IPAM router not found',
          code: 'IPAM_ROUTER_NOT_FOUND',
        });
      }
      res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_COORDINATES') {
        return res.status(400).json({
          error: 'Latitude or longitude is outside the valid range',
          code: 'COVERAGE_COORDINATES_INVALID',
        });
      }
      throw error;
    }
  }),
);

export default router;
