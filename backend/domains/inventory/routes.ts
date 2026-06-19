import { Router } from 'express';
import { WarehouseItem } from '../../../src/types';
import { store } from '../../../backend/state/store';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { inventoryRoutersService } from './routers/service';

const router = Router();

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const withState = (item: WarehouseItem) => {
  const state = store.getInventoryState(item.id);
  return {
    ...item,
    operationalStatus: state.operationalStatus,
    assignedToType: state.assignedToType,
    assignedToId: state.assignedToId,
    assignedToLabel: state.assignedToLabel,
    stateUpdatedAt: state.updatedAt,
  };
};

const parseOperationalStatus = (value: unknown) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'disponible') return 'Disponible' as const;
  if (raw === 'instalado') return 'Instalado' as const;
  if (raw === 'en reparacion') return 'En reparacion' as const;
  if (raw === 'danado') return 'Danado' as const;
  if (raw === 'perdido') return 'Perdido' as const;
  if (raw === 'baja') return 'Baja' as const;
  return null;
};

router.get('/api/inventory', requireRoles(READ_ROLES), (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const warehouse = String(req.query.warehouse || '').trim();
  const status = parseOperationalStatus(req.query.operationalStatus);

  const rows = store.INVENTORY
    .filter((item) => {
      const state = store.getInventoryState(item.id);
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.model.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q);
      const matchesWarehouse = !warehouse || item.warehouse === warehouse;
      const matchesStatus = !status || state.operationalStatus === status;
      return matchesQuery && matchesWarehouse && matchesStatus;
    })
    .map(withState);

  res.json(rows);
});

router.get('/api/inventory/movements', requireRoles(READ_ROLES), (req, res) => {
  const itemId = String(req.query.itemId || '').trim();
  const rows = itemId
    ? store.INVENTORY_MOVEMENTS.filter((row) => row.itemId === itemId)
    : store.INVENTORY_MOVEMENTS;
  res.json(rows);
});

router.get('/api/inventory/assignments', requireRoles(READ_ROLES), (req, res) => {
  const itemId = String(req.query.itemId || '').trim();
  const rows = itemId
    ? store.INVENTORY_ASSIGNMENTS.filter((row) => row.itemId === itemId)
    : store.INVENTORY_ASSIGNMENTS;
  res.json(rows);
});

router.get('/api/inventory/:id/state', requireRoles(READ_ROLES), (req, res) => {
  const item = store.INVENTORY.find((row) => row.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }
  const state = store.getInventoryState(item.id);
  res.json({
    itemId: item.id,
    itemName: item.name,
    ...state,
  });
});

router.put('/api/inventory/:id/state', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const item = store.INVENTORY.find((row) => row.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }

  const state = store.getInventoryState(item.id);
  const nextStatus = parseOperationalStatus(req.body.operationalStatus);
  if (!nextStatus) {
    return res.status(400).json({ error: 'Invalid operationalStatus' });
  }

  state.operationalStatus = nextStatus;
  state.updatedAt = nowStamp();

  res.json({
    itemId: item.id,
    itemName: item.name,
    ...state,
  });
});

router.put('/api/inventory/:id', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const index = store.INVENTORY.findIndex((row) => row.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }

  const current = store.INVENTORY[index];
  const { name, category, model, brand, warehouse, serials } = req.body;
  store.INVENTORY[index] = {
    ...current,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(model !== undefined ? { model: String(model) } : {}),
    ...(brand !== undefined ? { brand: String(brand) } : {}),
    ...(warehouse !== undefined ? { warehouse } : {}),
    ...(serials !== undefined
      ? {
          serials: Array.isArray(serials)
            ? serials
            : String(serials)
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
        }
      : {}),
  };

  res.json(withState(store.INVENTORY[index]));
});

router.post('/api/inventory/movement', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const { itemId, type, qty, toWarehouse, reason } = req.body;
  const qtyNum = Number(qty);
  if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
    return res.status(400).json({ error: 'Invalid qty. Must be greater than 0.' });
  }

  const item = store.INVENTORY.find((i) => i.id === itemId);
  if (item) {
    const originalWarehouse = item.warehouse;

    if (type === 'in') {
      item.qty += qtyNum;
      const state = store.getInventoryState(item.id);
      if (state.operationalStatus === 'Perdido' || state.operationalStatus === 'Baja') {
        state.operationalStatus = 'Disponible';
      }
      state.updatedAt = nowStamp();
    } else if (type === 'out') {
      if (item.qty >= qtyNum) {
        item.qty -= qtyNum;
      } else {
        return res.status(400).json({ error: 'Insufficient stock' });
      }
    } else if (type === 'transfer') {
      if (!toWarehouse) {
        return res.status(400).json({ error: 'toWarehouse is required for transfer movements' });
      }

      if (item.qty >= qtyNum) {
        item.qty -= qtyNum;
        const destItem = store.INVENTORY.find((i) => i.name === item.name && i.warehouse === toWarehouse);
        if (destItem) {
          destItem.qty += qtyNum;
        } else {
          const createdItem: WarehouseItem = {
            id: 'item-' + Date.now(),
            name: item.name,
            category: item.category,
            model: item.model,
            brand: item.brand,
            qty: qtyNum,
            warehouse: toWarehouse,
            serials: [],
          };
          store.INVENTORY.push(createdItem);
          store.getInventoryState(createdItem.id);
        }
      } else {
        return res.status(400).json({ error: 'Insufficient stock for transfer' });
      }
    } else {
      return res.status(400).json({ error: 'Invalid movement type' });
    }

    store.logInventoryMovement({
      itemId: item.id,
      itemName: item.name,
      type,
      qty: qtyNum,
      fromWarehouse: originalWarehouse,
      toWarehouse: type === 'transfer' ? toWarehouse : undefined,
      reason: reason ? String(reason) : undefined,
      actorId: req.authContext?.userId,
    });

    res.json(store.INVENTORY.map(withState));
  } else {
    res.status(404).json({ error: 'Inventory item not found' });
  }
});

router.post('/api/inventory/:id/assign', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const item = store.INVENTORY.find((row) => row.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }

  const qty = Number(req.body.qty || 1);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Invalid qty. Must be greater than 0.' });
  }
  if (item.qty < qty) {
    return res.status(400).json({ error: 'Insufficient stock for assignment' });
  }

  const targetType = req.body.targetType as 'tower' | 'client' | 'technician' | undefined;
  const targetId = req.body.targetId ? String(req.body.targetId) : undefined;
  const targetLabel = req.body.targetLabel ? String(req.body.targetLabel) : undefined;
  if (!targetType || !targetId || !targetLabel) {
    return res.status(400).json({ error: 'Missing assignment target fields: targetType, targetId, targetLabel' });
  }

  item.qty -= qty;
  const state = store.getInventoryState(item.id);
  state.operationalStatus = 'Instalado';
  state.assignedToType = targetType;
  state.assignedToId = targetId;
  state.assignedToLabel = targetLabel;
  state.updatedAt = nowStamp();

  store.logInventoryAssignment({
    itemId: item.id,
    itemName: item.name,
    action: 'assign',
    qty,
    targetType,
    targetId,
    targetLabel,
    notes: req.body.notes ? String(req.body.notes) : undefined,
    actorId: req.authContext?.userId,
  });

  store.logInventoryMovement({
    itemId: item.id,
    itemName: item.name,
    type: 'out',
    qty,
    fromWarehouse: item.warehouse,
    reason: `Asignacion a ${targetType}:${targetLabel}`,
    actorId: req.authContext?.userId,
  });

  res.json(withState(item));
});

router.post('/api/inventory/:id/unassign', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const item = store.INVENTORY.find((row) => row.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }

  const qty = Number(req.body.qty || 1);
  if (!Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Invalid qty. Must be greater than 0.' });
  }

  item.qty += qty;
  const state = store.getInventoryState(item.id);
  state.operationalStatus = 'Disponible';
  state.assignedToType = 'warehouse';
  state.assignedToId = 'principal';
  state.assignedToLabel = item.warehouse;
  state.updatedAt = nowStamp();

  store.logInventoryAssignment({
    itemId: item.id,
    itemName: item.name,
    action: 'unassign',
    qty,
    targetType: req.body.targetType,
    targetId: req.body.targetId ? String(req.body.targetId) : undefined,
    targetLabel: req.body.targetLabel ? String(req.body.targetLabel) : undefined,
    notes: req.body.notes ? String(req.body.notes) : undefined,
    actorId: req.authContext?.userId,
  });

  store.logInventoryMovement({
    itemId: item.id,
    itemName: item.name,
    type: 'in',
    qty,
    toWarehouse: item.warehouse,
    reason: 'Retorno de asignacion tecnica',
    actorId: req.authContext?.userId,
  });

  res.json(withState(item));
});

router.post('/api/inventory/add', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const { name, category, model, brand, qty, warehouse, serials } = req.body;
  if (!name || !model || !brand) {
    return res.status(400).json({ error: 'Missing required fields: name, model, and brand are required' });
  }

  const initialQty = Number(qty) || 0;
  const serialsArr = Array.isArray(serials)
    ? serials
    : (serials ? String(serials).split(',').map((s) => s.trim()).filter(Boolean) : []);

  const newItem: WarehouseItem = {
    id: `item-${Date.now()}`,
    name,
    category: category || 'Other',
    model,
    brand,
    qty: initialQty,
    warehouse: warehouse || 'Principal',
    serials: serialsArr,
  };

  store.INVENTORY.unshift(newItem);
  const state = store.getInventoryState(newItem.id);
  state.assignedToLabel = newItem.warehouse;
  state.updatedAt = nowStamp();

  store.logInventoryMovement({
    itemId: newItem.id,
    itemName: newItem.name,
    type: 'in',
    qty: initialQty,
    toWarehouse: newItem.warehouse,
    reason: 'Alta inicial de articulo',
    actorId: req.authContext?.userId,
  });

  res.status(201).json(withState(newItem));
});

// ====================================================================
// Inventory Read-Only de routers MikroTik (Fase 4.11.1).
//
// READ-ONLY: lee `mikrotik_routers` desde el store en memoria
// (`USE_DB_MIKROTIK` apagado). Sin escritura, sin conexión RouterOS, sin
// comandos. No expone secretos. RBAC de lectura de operación; Cobranza queda
// excluido (no opera infraestructura de red), igual que el provisioning.
// ====================================================================
const INVENTORY_ROUTERS_READ_ROLES = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'] as const;

router.get('/api/inventory/routers', requireRoles([...INVENTORY_ROUTERS_READ_ROLES]), (_req, res) => {
  res.json(inventoryRoutersService.listRouters());
});

router.get('/api/inventory/summary', requireRoles([...INVENTORY_ROUTERS_READ_ROLES]), (_req, res) => {
  res.json(inventoryRoutersService.getSummary());
});

router.get('/api/inventory/routers/:id', requireRoles([...INVENTORY_ROUTERS_READ_ROLES]), (req, res) => {
  const view = inventoryRoutersService.getRouter(req.params.id);
  if (!view) {
    res.status(404).json({ error: 'Router not found in inventory' });
    return;
  }
  res.json(view);
});

export default router;
