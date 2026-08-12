import { Router } from 'express';
import { WarehouseItem } from '../../../src/types';
import type { InventoryItemState } from '../../state/store';
import { asyncHandler } from '../../common/errors';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { isDomainOnDb } from '../../config/feature-flags';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { getInventoryService } from './service';
import { inventoryRoutersService } from './routers/service';
import {
  customerEquipmentService,
  EquipmentReservationError,
} from './customer-equipment/service';
import { getSerialUnitsService } from './serial-units/service';

const router = Router();

// Roles de escritura del inventario (igual que el contrato previo de routes.ts):
// Cobranza, Soporte y Solo lectura quedan fuera de las mutaciones.
const WRITE_ROLES = ['super admin', 'administrador', 'tecnico'] as const;

// ====================================================================
// Customer equipment (reservas) — sin cambios de contrato.
// ====================================================================
router.get('/api/inventory/customer-equipment', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  // Preferir inventario real (DB/store) sobre mocks.
  try {
    const items = await getInventoryService().listItems({});
    const mapped = items
      .filter((item) => ['CPE', 'Fiber', 'Other', 'Antenna'].includes(item.category)
        && (item.qty > 0 || (item.serials?.length ?? 0) > 0))
      .map((item) => ({
        id: item.id,
        kind: item.category === 'Fiber' ? 'ONU' : item.category === 'CPE' || item.category === 'Antenna' ? 'CPE' : 'OTHER',
        name: item.name,
        brand: item.brand,
        model: item.model,
        availableQty: Math.max(item.qty, item.serials?.length ?? 0),
        serials: [...(item.serials || [])],
      }));
    if (mapped.length > 0 && isDomainOnDb('inventory')) {
      return res.json(mapped);
    }
  } catch {
    // fallback al listado del servicio (store + mocks condicionales)
  }
  res.json(customerEquipmentService.listEquipment());
}));

router.get('/api/inventory/customer-equipment/reservations', requireRoles(READ_ROLES), (_req, res) => {
  res.json(customerEquipmentService.listReservations());
});

router.post(
  '/api/inventory/customer-equipment/reservations',
  requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']),
  (req, res) => {
    try {
      const reservation = customerEquipmentService.reserve({
        equipmentId: String(req.body?.equipmentId || ''),
        serial: String(req.body?.serial || ''),
        mac: String(req.body?.mac || ''),
        customerLabel: String(req.body?.customerLabel || ''),
      });
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof EquipmentReservationError) {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  },
);

router.post(
  '/api/inventory/customer-equipment/manual-reservations',
  requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']),
  (req, res) => {
    try {
      const reservation = customerEquipmentService.reserveManual({
        name: String(req.body?.name || ''),
        kind: (String(req.body?.kind || 'CPE') as 'CPE' | 'POE' | 'POWER_SUPPLY' | 'ONU' | 'OTHER'),
        brand: req.body?.brand ? String(req.body.brand) : undefined,
        model: req.body?.model ? String(req.body.model) : undefined,
        serial: String(req.body?.serial || ''),
        mac: String(req.body?.mac || ''),
        customerLabel: String(req.body?.customerLabel || ''),
      });
      res.status(201).json(reservation);
    } catch (error) {
      if (error instanceof EquipmentReservationError) {
        return res.status(400).json({ error: error.message, code: error.code });
      }
      throw error;
    }
  },
);

// ====================================================================
// Inventory Read-Only de routers MikroTik (Fase 4.11.1) — sin cambios.
// READ-ONLY: lee `mikrotik_routers` desde el store; sin escritura, sin RouterOS.
// Definido ANTES de las rutas con `:id` para precedencia de rutas literales.
// ====================================================================
const INVENTORY_ROUTERS_READ_ROLES = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'] as const;

router.get(
  '/api/inventory/routers',
  requireRoles([...INVENTORY_ROUTERS_READ_ROLES]),
  asyncHandler(async (req, res) => {
    res.json(await inventoryRoutersService.listRouters(tenantIdFromRequest(req)));
  }),
);

router.get(
  '/api/inventory/summary',
  requireRoles([...INVENTORY_ROUTERS_READ_ROLES]),
  asyncHandler(async (req, res) => {
    res.json(await inventoryRoutersService.getSummary(tenantIdFromRequest(req)));
  }),
);

router.get(
  '/api/inventory/routers/:id',
  requireRoles([...INVENTORY_ROUTERS_READ_ROLES]),
  asyncHandler(async (req, res) => {
    const view = await inventoryRoutersService.getRouter(req.params.id, tenantIdFromRequest(req));
    if (!view) {
      res.status(404).json({ error: 'Router not found in inventory' });
      return;
    }
    res.json(view);
  }),
);

// ====================================================================
// Almacenes (Fase 5.1) — entidad de primera clase. Rutas literales antes
// de `/api/inventory/:id/*` para evitar captura por el parámetro.
// ====================================================================
router.get('/api/inventory/warehouses', requireRoles(READ_ROLES), asyncHandler(async (_req, res) => {
  res.json(await getInventoryService().listWarehouses());
}));

router.post('/api/inventory/warehouses', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const created = await getInventoryService().createWarehouse({
    name: String(req.body?.name ?? ''),
    code: req.body?.code !== undefined ? String(req.body.code) : undefined,
    type: req.body?.type,
    location: req.body?.location !== undefined ? String(req.body.location) : undefined,
    notes: req.body?.notes !== undefined ? String(req.body.notes) : undefined,
    isActive: req.body?.isActive,
  });
  res.status(201).json(created);
}));

router.get('/api/inventory/warehouses/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const wh = await getInventoryService().getWarehouse(req.params.id);
  if (!wh) {
    res.status(404).json({ error: 'Warehouse not found' });
    return;
  }
  res.json(wh);
}));

router.get('/api/inventory/warehouses/:id/stock', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const stock = await getInventoryService().getWarehouseStock(req.params.id);
  if (!stock) {
    res.status(404).json({ error: 'Warehouse not found' });
    return;
  }
  res.json(stock);
}));

router.put('/api/inventory/warehouses/:id', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const { name, code, type, location, notes, isActive } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = String(name);
  if (code !== undefined) patch.code = String(code);
  if (type !== undefined) patch.type = type;
  if (location !== undefined) patch.location = String(location);
  if (notes !== undefined) patch.notes = String(notes);
  if (isActive !== undefined) patch.isActive = Boolean(isActive);
  const updated = await getInventoryService().updateWarehouse(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: 'Warehouse not found' });
    return;
  }
  res.json(updated);
}));

router.delete('/api/inventory/warehouses/:id', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const ok = await getInventoryService().deleteWarehouse(req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Warehouse not found' });
    return;
  }
  res.status(204).send();
}));

// ====================================================================
// Transferencias (Fase 5.1) — ciclo pending → completed/cancelled.
// ====================================================================
router.get('/api/inventory/transfers', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getInventoryService().listTransfers(tenantIdFromRequest(req)));
}));

router.post('/api/inventory/transfers', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const created = await getInventoryService().createTransfer({
    itemId: String(req.body?.itemId ?? ''),
    qty: req.body?.qty,
    toWarehouse: String(req.body?.toWarehouse ?? ''),
    reason: req.body?.reason !== undefined ? String(req.body.reason) : undefined,
    actorId: req.authContext?.userId,
  }, tenantIdFromRequest(req));
  res.status(201).json(created);
}));

router.get('/api/inventory/transfers/:id', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const transfer = await getInventoryService().getTransfer(req.params.id, tenantIdFromRequest(req));
  if (!transfer) {
    res.status(404).json({ error: 'Transfer not found' });
    return;
  }
  res.json(transfer);
}));

router.post('/api/inventory/transfers/:id/complete', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getInventoryService().completeTransfer(req.params.id, tenantIdFromRequest(req)));
}));

router.post('/api/inventory/transfers/:id/cancel', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  res.json(await getInventoryService().cancelTransfer(req.params.id, tenantIdFromRequest(req)));
}));

// ====================================================================
// Items, movimientos y asignaciones — contrato API v1 preservado.
// ====================================================================
router.get('/api/inventory', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const rows = await getInventoryService().listItems({
    q: String(req.query.q || '').trim().toLowerCase() || undefined,
    warehouse: String(req.query.warehouse || '').trim() || undefined,
    operationalStatus: normalizeOpStatus(req.query.operationalStatus),
  });
  res.json(rows);
}));

router.get('/api/inventory/movements', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const itemId = String(req.query.itemId || '').trim() || undefined;
  res.json(await getInventoryService().listMovements(itemId));
}));

router.get('/api/inventory/assignments', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const itemId = String(req.query.itemId || '').trim() || undefined;
  res.json(await getInventoryService().listAssignments(itemId));
}));

router.get('/api/inventory/serial-units', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  res.json(await getSerialUnitsService().list({
    itemId: req.query.itemId ? String(req.query.itemId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
  }));
}));

router.post('/api/inventory/serial-units', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const created = await getSerialUnitsService().create(req.body || {});
  res.status(201).json(created);
}));

router.post('/api/inventory/serial-units/:id/assign-client', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const clientId = String(req.body?.clientId || '').trim();
  if (!clientId) {
    return res.status(400).json({ error: 'Missing clientId', code: 'MISSING_FIELD' });
  }
  res.json(await getSerialUnitsService().assignToClient(req.params.id, clientId));
}));

router.get('/api/inventory/:id/state', requireRoles(READ_ROLES), asyncHandler(async (req, res) => {
  const state = await getInventoryService().getItemState(req.params.id);
  if (!state) {
    res.status(404).json({ error: 'Inventory item not found' });
    return;
  }
  res.json(state);
}));

router.put('/api/inventory/:id/state', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const state = await getInventoryService().setOperationalStatus(req.params.id, req.body.operationalStatus);
  if (!state) {
    res.status(404).json({ error: 'Inventory item not found' });
    return;
  }
  res.json(state);
}));

router.put('/api/inventory/:id', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const { name, category, model, brand, warehouse, serials } = req.body ?? {};
  const patch: Partial<WarehouseItem> = {};
  if (name !== undefined) patch.name = String(name);
  if (category !== undefined) patch.category = category;
  if (model !== undefined) patch.model = String(model);
  if (brand !== undefined) patch.brand = String(brand);
  if (warehouse !== undefined) patch.warehouse = warehouse;
  if (serials !== undefined) {
    patch.serials = Array.isArray(serials)
      ? serials
      : String(serials).split(',').map((v) => v.trim()).filter(Boolean);
  }
  const updated = await getInventoryService().updateItem(req.params.id, patch);
  if (!updated) {
    res.status(404).json({ error: 'Inventory item not found' });
    return;
  }
  res.json(updated);
}));

router.post('/api/inventory/movement', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const { itemId, type, qty, toWarehouse, reason } = req.body ?? {};
  const rows = await getInventoryService().applyMovement({
    itemId: String(itemId ?? ''),
    type,
    qty,
    toWarehouse: toWarehouse !== undefined ? String(toWarehouse) : undefined,
    reason: reason !== undefined ? String(reason) : undefined,
    actorId: req.authContext?.userId,
  });
  res.json(rows);
}));

router.post('/api/inventory/:id/assign', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const item = await getInventoryService().assign({
    itemId: req.params.id,
    qty: req.body?.qty ?? 1,
    targetType: req.body?.targetType,
    targetId: req.body?.targetId ? String(req.body.targetId) : '',
    targetLabel: req.body?.targetLabel ? String(req.body.targetLabel) : '',
    notes: req.body?.notes ? String(req.body.notes) : undefined,
    actorId: req.authContext?.userId,
  });
  res.json(item);
}));

router.post('/api/inventory/:id/unassign', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const item = await getInventoryService().unassign({
    itemId: req.params.id,
    qty: req.body?.qty ?? 1,
    targetType: req.body?.targetType,
    targetId: req.body?.targetId ? String(req.body.targetId) : undefined,
    targetLabel: req.body?.targetLabel ? String(req.body.targetLabel) : undefined,
    notes: req.body?.notes ? String(req.body.notes) : undefined,
    actorId: req.authContext?.userId,
  });
  res.json(item);
}));

router.post('/api/inventory/add', requireRoles([...WRITE_ROLES]), asyncHandler(async (req, res) => {
  const { name, category, model, brand, qty, warehouse, serials } = req.body ?? {};
  const created = await getInventoryService().addItem(
    {
      name: name ? String(name) : '',
      category,
      model: model ? String(model) : '',
      brand: brand ? String(brand) : '',
      qty,
      warehouse: warehouse !== undefined ? String(warehouse) : undefined,
      serials,
    },
    req.authContext?.userId,
  );
  res.status(201).json(created);
}));

// Normaliza el operationalStatus de query (acepta etiquetas en minúscula).
function normalizeOpStatus(value: unknown): InventoryItemState['operationalStatus'] | undefined {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return undefined;
  const map: Record<string, InventoryItemState['operationalStatus']> = {
    disponible: 'Disponible',
    instalado: 'Instalado',
    'en reparacion': 'En reparacion',
    danado: 'Danado',
    perdido: 'Perdido',
    baja: 'Baja',
  };
  return map[raw];
}

export default router;
