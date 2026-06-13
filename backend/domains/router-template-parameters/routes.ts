// ====================================================================
// Dynamic Template Parameters Engine (Fase 4.9.2) — Rutas.
//
// GET /api/router-templates/:id/parameters
//   Devuelve el esquema de parámetros de una plantilla para que el
//   Wizard genere el formulario dinámicamente (sin hardcodear campos).
//
// RBAC: super admin, administrador, tecnico (igual que enrollment).
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { requireRoles } from '../../common/rbac';
import { getParameterSchema } from './registry';

const router = Router();

const CAN_VIEW = ['super admin', 'administrador', 'tecnico'] as const;

router.get(
  '/api/router-templates/:id/parameters',
  requireRoles([...CAN_VIEW]),
  asyncHandler(async (req, res) => {
    const schema = getParameterSchema(req.params.id);
    if (!schema) {
      return res.status(404).json({
        error: `La plantilla '${req.params.id}' no tiene parámetros declarados.`,
        code: 'TEMPLATE_PARAMETERS_NOT_FOUND',
      });
    }
    res.json(schema);
  }),
);

export default router;
