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
import { asyncHandler, NotFoundError } from '../../common/errors';
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

router.get(
  '/api/inventory-sync/config-snapshots',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await inventorySyncService.listConfigSnapshots());
  }),
);

router.get(
  '/api/inventory-sync/config-snapshots/capture',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (_req, res) => {
    res.json(await inventorySyncService.captureConfigSnapshot());
  }),
);

router.get(
  '/api/inventory-sync/config-snapshots/diff',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (req, res) => {
    const fromId = String(req.query.from ?? '').trim();
    const toId = String(req.query.to ?? '').trim();
    if (!fromId || !toId) {
      res.status(400).json({ error: 'Query params "from" y "to" son requeridos.' });
      return;
    }
    const diff = await inventorySyncService.diffConfigSnapshots(fromId, toId);
    if (!diff) throw new NotFoundError('Snapshot no encontrado.', 'SNAPSHOT_NOT_FOUND');
    res.json(diff);
  }),
);

router.get(
  '/api/inventory-sync/config-snapshots/:id',
  requireRoles(INVENTORY_SYNC_ROLES),
  asyncHandler(async (req, res) => {
    const snapshot = await inventorySyncService.getConfigSnapshot(req.params.id);
    if (!snapshot) throw new NotFoundError('Snapshot no encontrado.', 'SNAPSHOT_NOT_FOUND');
    res.json(snapshot);
  }),
);

export default router;
