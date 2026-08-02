import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { coverageService } from './service';
import { getFtthFeasibilityService } from './ftth-feasibility';

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

/** Factibilidad FTTH de preventa: NAP más cercana con puerto libre. */
router.get(
  '/api/ftth/feasibility',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const latitude = Number(req.query.lat ?? req.query.latitude);
    const longitude = Number(req.query.lng ?? req.query.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        error: 'lat and lng are required',
        code: 'FEASIBILITY_INPUT_INVALID',
      });
    }

    const rawMax = req.query.maxDropMeters;
    const maxDropMeters = rawMax === undefined ? undefined : Number(rawMax);
    if (maxDropMeters !== undefined && (!Number.isFinite(maxDropMeters) || maxDropMeters <= 0)) {
      return res.status(400).json({
        error: 'maxDropMeters must be a positive number',
        code: 'FEASIBILITY_INPUT_INVALID',
      });
    }

    try {
      const result = await getFtthFeasibilityService().check({
        latitude,
        longitude,
        maxDropMeters,
        tenantId: tenantIdFromRequest(req),
      });
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
