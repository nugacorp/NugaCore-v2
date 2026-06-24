import { Router } from 'express';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { asyncHandler } from '../../common/errors';
import { runDataConsistencyCheck } from './consistency';

const router = Router();

// ────────────────────────────────────────────────────────────────────
// GET /api/system/data-consistency
//
// Auditoría read-only de consistencia de KPIs entre módulos. Devuelve
// healthy:false con el detalle de desajustes si algún consumidor (dashboard,
// cobranza) deja de coincidir con la fuente oficial de la métrica.
// ────────────────────────────────────────────────────────────────────
router.get(
  '/api/system/data-consistency',
  requireRoles(READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await runDataConsistencyCheck());
  }),
);

export default router;
