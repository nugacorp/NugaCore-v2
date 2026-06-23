// ====================================================================
// PROD-6 — Rutas Inventory Sync (READ-ONLY).
//
// SOLO endpoints GET. No existen POST/PUT/PATCH/DELETE: esta fase es incapaz de
// escribir. Ningún endpoint modifica inventario ni router; el snapshot proviene
// del RouterOS Read-Only Service (mock/routeros con fallback seguro).
//
// RBAC: Super Admin, Administrador, Técnico, Soporte, Solo lectura.
// Cobranza queda excluido (403).
// ====================================================================

import { Router } from 'express';
import { asyncHandler } from '../../common/errors';
import { AppRole, requireRoles } from '../../common/rbac';
import { inventorySyncService } from './service';

const INVENTORY_SYNC_ROLES: AppRole[] = [
  'super admin',
  'administrador',
  'tecnico',
  'soporte',
  'solo lectura',
];

const router = Router();

router.get(
  '/api/inventory-sync/status',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await inventorySyncService.getStatus());
  }),
);

router.get(
  '/api/inventory-sync/snapshot',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await inventorySyncService.getSnapshot());
  }),
);

router.get(
  '/api/inventory-sync/differences',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await inventorySyncService.getDifferences());
  }),
);

export default router;
