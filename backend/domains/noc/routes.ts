import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { nocReadOnlyService } from './service';

// ====================================================================
// NOC Read-Only Foundation (Fase 4.11.2)
//
// Endpoints solo lectura para operación NOC. Cobranza queda excluido.
// No existen endpoints de escritura en este dominio.
// ====================================================================

const NOC_READ_ROLES: AppRole[] = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'];

const router = Router();

router.get(
  '/api/noc/summary',
  requireRoles(NOC_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await nocReadOnlyService.getSummary());
  }),
);

router.get(
  '/api/noc/routers',
  requireRoles(NOC_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await nocReadOnlyService.listRouters());
  }),
);

router.get(
  '/api/noc/alerts',
  requireRoles(NOC_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await nocReadOnlyService.listAlerts());
  }),
);

export default router;
