// ====================================================================
// PROD-3/PROD-4 — Rutas RouterOS Read-Only (laboratorio).
//
// SOLO endpoints GET. No existen POST/PUT/PATCH/DELETE: esta fase es
// físicamente incapaz de escribir. Ningún endpoint ejecuta comandos de
// modificación ni toca routers reales; el provider activo es solo lectura y,
// ante fallo, cae a mock seguro.
//
// RBAC: Super Admin, Administrador, Técnico, Soporte, Solo lectura.
// Cobranza queda excluido (403).
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { routerOsReadOnlyService } from './service';

const ROUTEROS_READ_ROLES: AppRole[] = [
  'super admin',
  'administrador',
  'tecnico',
  'soporte',
  'solo lectura',
];

const router = Router();

router.get(
  '/api/routeros/identity',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await routerOsReadOnlyService.getIdentity());
  }),
);

router.get(
  '/api/routeros/system',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await routerOsReadOnlyService.getSystem());
  }),
);

router.get(
  '/api/routeros/interfaces',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await routerOsReadOnlyService.getInterfaces());
  }),
);

router.get(
  '/api/routeros/routes',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await routerOsReadOnlyService.getRoutes());
  }),
);

router.get(
  '/api/routeros/wireguard',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await routerOsReadOnlyService.getWireguard());
  }),
);

export default router;
