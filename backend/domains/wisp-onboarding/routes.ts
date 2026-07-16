import { Router } from 'express';
import { asyncHandler, BadRequestError } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getWispOnboardingService } from './service';

const router = Router();

/** Registro público de un nuevo WISP (crea tenant aislado + owner). */
router.post('/api/wisp-onboarding/register', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await getWispOnboardingService().register({
    companyName: String(body.companyName || ''),
    slug: String(body.slug || ''),
    email: String(body.email || ''),
    password: String(body.password || ''),
    fullName: String(body.fullName || ''),
    phone: body.phone ? String(body.phone) : undefined,
    city: body.city ? String(body.city) : undefined,
  });
  res.status(201).json(result);
}));

router.get(
  '/api/wisp-onboarding/status',
  requireRoles(READ_ROLES),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    const service = getWispOnboardingService();
    const required = await service.isOnboardingRequired(tenantId);
    const state = await service.getStatus(tenantId);
    res.json({
      tenantId,
      required,
      complete: !required,
      state,
    });
  }),
);

router.put(
  '/api/wisp-onboarding/steps/company',
  requireRoles(['super admin', 'administrador']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    const body = req.body || {};
    res.json(await getWispOnboardingService().saveCompany(tenantId, {
      companyName: String(body.companyName || ''),
      contactPhone: body.contactPhone ? String(body.contactPhone) : undefined,
      city: body.city ? String(body.city) : undefined,
    }));
  }),
);

router.put(
  '/api/wisp-onboarding/steps/zone',
  requireRoles(['super admin', 'administrador']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    const body = req.body || {};
    res.json(await getWispOnboardingService().saveZone(tenantId, {
      zoneName: String(body.zoneName || ''),
      lat: body.lat != null ? Number(body.lat) : undefined,
      lng: body.lng != null ? Number(body.lng) : undefined,
    }));
  }),
);

router.put(
  '/api/wisp-onboarding/steps/billing',
  requireRoles(['super admin', 'administrador']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    const body = req.body || {};
    if (body.billingCycleDay == null) {
      throw new BadRequestError('billingCycleDay requerido', 'MISSING_FIELD');
    }
    res.json(await getWispOnboardingService().saveBilling(tenantId, {
      billingCycleDay: Number(body.billingCycleDay),
      billingCycleTime: body.billingCycleTime ? String(body.billingCycleTime) : undefined,
    }));
  }),
);

router.put(
  '/api/wisp-onboarding/steps/router',
  requireRoles(['super admin', 'administrador']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    const body = req.body || {};
    res.json(await getWispOnboardingService().saveRouter(tenantId, {
      routerName: String(body.routerName || ''),
      routerId: body.routerId ? String(body.routerId) : undefined,
    }));
  }),
);

router.post(
  '/api/wisp-onboarding/complete',
  requireRoles(['super admin', 'administrador']),
  asyncHandler(async (req, res) => {
    const tenantId = tenantIdFromRequest(req);
    res.json(await getWispOnboardingService().complete(tenantId));
  }),
);

export default router;
