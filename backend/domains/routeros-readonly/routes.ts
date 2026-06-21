// ====================================================================
// PROD-3 — Rutas RouterOS Read-Only (laboratorio, mock).
//
// SOLO endpoints GET. No existen POST/PUT/PATCH/DELETE: esta fase es
// físicamente incapaz de escribir. Ningún endpoint ejecuta RouterOS, abre
// conexiones ni toca routers reales.
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
    res.json(routerOsReadOnlyService.getIdentity());
  }),
);

router.get(
  '/api/routeros/system',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(routerOsReadOnlyService.getSystem());
  }),
);

router.get(
  '/api/routeros/interfaces',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(routerOsReadOnlyService.getInterfaces());
  }),
);

router.get(
  '/api/routeros/routes',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(routerOsReadOnlyService.getRoutes());
  }),
);

router.get(
  '/api/routeros/wireguard',
  requireRoles(ROUTEROS_READ_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(routerOsReadOnlyService.getWireguard());
  }),
);

export default router;
