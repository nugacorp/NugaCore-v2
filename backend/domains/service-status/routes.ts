import { Router } from 'express';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import {
  ServiceStatusError,
  getServiceStatus,
  getServiceStatusSummary,
  listServiceStatusAudit,
  listServiceStatuses,
  requestReactivation,
  requestSuspension,
} from './service';

// ====================================================================
// Rutas del dominio Service Status (Pre-PROD-7).
//
// Lectura: todos los roles (READ_ROLES). Solicitudes de transición:
// super admin / administrador / cobranza. Las solicitudes SOLO marcan estado
// pendiente (dryRun); no ejecutan cambios reales en la red ni en equipos.
// ====================================================================

const router = Router();

const REQUEST_ROLES = ['super admin', 'administrador', 'cobranza'] as const;

// ── Lectura ───────────────────────────────────────────────────────────
router.get('/api/service-status/customers', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await listServiceStatuses());
}));

router.get('/api/service-status/summary', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getServiceStatusSummary());
}));

router.get('/api/service-status/audit', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const customerId = String(req.query.customerId || '').trim();
  res.json(listServiceStatusAudit(customerId || undefined));
}));

// Va después de las rutas específicas para no capturar /summary ni /audit.
router.get('/api/service-status/customers/:customerId', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const view = await getServiceStatus(req.params.customerId);
  if (!view) {
    res.status(404).json({ error: 'Customer not found' });
    return;
  }
  res.json(view);
}));

// ── Solicitudes controladas (mock / dryRun) ───────────────────────────
const handleTransition = (kind: 'suspension' | 'reactivation') =>
  asyncHandler(async (req, res) => {
    const actorRole = req.authContext?.role ?? null;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    try {
      const apply = kind === 'suspension' ? requestSuspension : requestReactivation;
      const result = await apply(req.params.customerId, reason, actorRole);
      res.status(201).json({
        dryRun: true,
        note: 'Estado marcado como pendiente. No se ejecutan cambios reales en la red ni en equipos.',
        ...result,
      });
    } catch (err) {
      if (err instanceof ServiceStatusError) {
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  });

router.post(
  '/api/service-status/customers/:customerId/request-suspension',
  requireRoles([...REQUEST_ROLES]),
  handleTransition('suspension'),
);

router.post(
  '/api/service-status/customers/:customerId/request-reactivation',
  requireRoles([...REQUEST_ROLES]),
  handleTransition('reactivation'),
);

export default router;
