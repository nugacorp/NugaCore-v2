// ====================================================================
// Tipos del dominio Inventario ERP (Fase 5.1).
//
// Reúne los tipos del store ya existentes (WarehouseItem, InventoryItemState,
// InventoryMovementLog, InventoryAssignmentLog) con las entidades NUEVAS de la
// fase: Warehouse (almacén de primera clase) y InventoryTransfer (transferencia
// de primera clase). Estos tipos son el contrato que comparten store y DB.
// ====================================================================

import type { WarehouseItem } from '../../../src/types';
import type {
  InventoryItemState,
  } from '../../state/store';

export type {
  InventoryAssignmentLog,
  InventoryItemState,
  InventoryMovementLog,
} from '../../state/store';
export type { WarehouseItem } from '../../../src/types';

// Vista de artículo enriquecida con su estado operativo (lo que devuelve
// `/api/inventory` hoy vía `withState`). El contrato no cambia.
export interface InventoryItemView extends WarehouseItem {
  operationalStatus: InventoryItemState['operationalStatus'];
  assignedToType?: InventoryItemState['assignedToType'];
  assignedToId?: string;
  assignedToLabel?: string;
  stateUpdatedAt: string;
}

export type WarehouseType = 'principal' | 'torre' | 'vehiculo' | 'tecnico' | 'otro';

export interface Warehouse {
  id: string;
  code?: string;
  name: string;
  type: WarehouseType;
  location?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWarehouseInput {
  code?: string;
  name: string;
  type?: WarehouseType;
  location?: string;
  notes?: string;
  isActive?: boolean;
}

export type TransferStatus = 'pending' | 'completed' | 'cancelled';

export interface InventoryTransfer {
  id: string;
  itemId: string;
  itemName: string;
  qty: number;
  fromWarehouse: string;
  toWarehouse: string;
  status: TransferStatus;
  reason?: string;
  actorId?: string;
  createdAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface CreateTransferInput {
  itemId: string;
  qty: number;
  toWarehouse: string;
  reason?: string;
  actorId?: string;
}

// Stock agregado por almacén (para la vista "stock por almacén").
export interface WarehouseStockRow {
  itemId: string;
  name: string;
  category: string;
  model: string;
  brand: string;
  qty: number;
}

export interface WarehouseStock {
  warehouse: string;
  totalUnits: number;
  distinctItems: number;
  items: WarehouseStockRow[];
}

// Inputs de operaciones existentes (mantienen el contrato actual de routes.ts).
export interface AddItemInput {
  name: string;
  category?: WarehouseItem['category'];
  model: string;
  brand: string;
  qty?: number;
  warehouse?: string;
  serials?: string[] | string;
}

export type MovementType = 'in' | 'out' | 'transfer';

export interface MovementInput {
  itemId: string;
  type: MovementType;
  qty: number;
  toWarehouse?: string;
  reason?: string;
  actorId?: string;
}

export interface AssignInput {
  itemId: string;
  qty: number;
  targetType: 'tower' | 'client' | 'technician';
  targetId: string;
  targetLabel: string;
  notes?: string;
  actorId?: string;
}

export interface UnassignInput {
  itemId: string;
  qty: number;
  targetType?: 'tower' | 'client' | 'technician';
  targetId?: string;
  targetLabel?: string;
  notes?: string;
  actorId?: string;
}
