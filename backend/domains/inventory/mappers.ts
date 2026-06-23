// ====================================================================
// Mappers del dominio Inventario — traducen entre filas de Postgres
// (snake_case) y los tipos del frontend/dominio (camelCase).
//
// Regla del DATA_CONTRACT: aquí ocurre la ÚNICA traducción de nombres.
// Los valores de enum NO se traducen (la DB guarda el mismo valor que la app).
// ====================================================================

import type { WarehouseItem } from '../../../src/types';
import type {
  InventoryAssignmentLog,
  InventoryMovementLog,
  InventoryItemView,
  InventoryTransfer,
  Warehouse,
} from './types';

// --------------------------------------------------------------------
// Filas de DB (forma laxa: lo que devuelve supabase-js sin tipos generados)
// --------------------------------------------------------------------
export interface WarehouseRow {
  id: string;
  code: string | null;
  name: string;
  type: Warehouse['type'];
  location: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemRow {
  id: string;
  name: string;
  category: WarehouseItem['category'];
  model: string;
  brand: string;
  warehouse: string;
  qty: number;
  serials: string[] | null;
  operational_status: InventoryItemView['operationalStatus'];
  assigned_to_type: InventoryItemView['assignedToType'] | null;
  assigned_to_id: string | null;
  assigned_to_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryMovementRow {
  id: string;
  item_id: string;
  item_name: string;
  type: InventoryMovementLog['type'] | 'adjust';
  qty: number;
  from_warehouse: string | null;
  to_warehouse: string | null;
  reason: string | null;
  actor_id: string | null;
  created_at: string;
}

export interface InventoryTransferRow {
  id: string;
  item_id: string;
  item_name: string;
  qty: number;
  from_warehouse: string;
  to_warehouse: string;
  status: InventoryTransfer['status'];
  reason: string | null;
  actor_id: string | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface InventoryAssignmentRow {
  id: string;
  item_id: string;
  item_name: string;
  action: InventoryAssignmentLog['action'];
  qty: number;
  target_type: InventoryAssignmentLog['targetType'] | null;
  target_id: string | null;
  target_label: string | null;
  notes: string | null;
  actor_id: string | null;
  created_at: string;
}

// --------------------------------------------------------------------
// Warehouses
// --------------------------------------------------------------------
export const rowToWarehouse = (row: WarehouseRow): Warehouse => ({
  id: row.id,
  ...(row.code ? { code: row.code } : {}),
  name: row.name,
  type: row.type,
  ...(row.location ? { location: row.location } : {}),
  ...(row.notes ? { notes: row.notes } : {}),
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const warehouseToRow = (wh: Warehouse): WarehouseRow => ({
  id: wh.id,
  code: wh.code ?? null,
  name: wh.name,
  type: wh.type,
  location: wh.location ?? null,
  notes: wh.notes ?? null,
  is_active: wh.isActive,
  created_at: wh.createdAt,
  updated_at: wh.updatedAt,
});

const WAREHOUSE_CAMEL_TO_SNAKE: Partial<Record<keyof Warehouse, keyof WarehouseRow>> = {
  code: 'code',
  name: 'name',
  type: 'type',
  location: 'location',
  notes: 'notes',
  isActive: 'is_active',
};

export const warehousePatchToRow = (patch: Partial<Warehouse>): Partial<WarehouseRow> => {
  const row: Partial<WarehouseRow> = {};
  for (const key of Object.keys(patch) as (keyof Warehouse)[]) {
    const column = WAREHOUSE_CAMEL_TO_SNAKE[key];
    if (!column) continue;
    (row as Record<string, unknown>)[column] = (patch as Record<string, unknown>)[key];
  }
  return row;
};

// --------------------------------------------------------------------
// Inventory items (incluye el estado operativo fundido en la fila)
// --------------------------------------------------------------------
export const rowToItemView = (row: InventoryItemRow): InventoryItemView => ({
  id: row.id,
  name: row.name,
  category: row.category,
  model: row.model,
  brand: row.brand,
  warehouse: row.warehouse as WarehouseItem['warehouse'],
  qty: row.qty,
  serials: Array.isArray(row.serials) ? row.serials : [],
  operationalStatus: row.operational_status,
  ...(row.assigned_to_type ? { assignedToType: row.assigned_to_type } : {}),
  ...(row.assigned_to_id ? { assignedToId: row.assigned_to_id } : {}),
  ...(row.assigned_to_label ? { assignedToLabel: row.assigned_to_label } : {}),
  stateUpdatedAt: row.updated_at,
});

// --------------------------------------------------------------------
// Movements
// --------------------------------------------------------------------
export const rowToMovement = (row: InventoryMovementRow): InventoryMovementLog => ({
  id: row.id,
  itemId: row.item_id,
  itemName: row.item_name,
  type: row.type as InventoryMovementLog['type'],
  qty: row.qty,
  ...(row.from_warehouse ? { fromWarehouse: row.from_warehouse } : {}),
  ...(row.to_warehouse ? { toWarehouse: row.to_warehouse } : {}),
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.actor_id ? { actorId: row.actor_id } : {}),
  createdAt: row.created_at,
});

// --------------------------------------------------------------------
// Transfers
// --------------------------------------------------------------------
export const rowToTransfer = (row: InventoryTransferRow): InventoryTransfer => ({
  id: row.id,
  itemId: row.item_id,
  itemName: row.item_name,
  qty: row.qty,
  fromWarehouse: row.from_warehouse,
  toWarehouse: row.to_warehouse,
  status: row.status,
  ...(row.reason ? { reason: row.reason } : {}),
  ...(row.actor_id ? { actorId: row.actor_id } : {}),
  createdAt: row.created_at,
  ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
});

// --------------------------------------------------------------------
// Assignments
// --------------------------------------------------------------------
export const rowToAssignment = (row: InventoryAssignmentRow): InventoryAssignmentLog => ({
  id: row.id,
  itemId: row.item_id,
  itemName: row.item_name,
  action: row.action,
  qty: row.qty,
  ...(row.target_type ? { targetType: row.target_type } : {}),
  ...(row.target_id ? { targetId: row.target_id } : {}),
  ...(row.target_label ? { targetLabel: row.target_label } : {}),
  ...(row.notes ? { notes: row.notes } : {}),
  ...(row.actor_id ? { actorId: row.actor_id } : {}),
  createdAt: row.created_at,
});
