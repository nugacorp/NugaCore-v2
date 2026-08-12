// ====================================================================
// Repository del dominio Inventario ERP (Fase 5.1).
//
// Define el contrato `InventoryRepository` y dos implementaciones con la
// MISMA interfaz:
//   - StoreInventoryRepository    → store en memoria (modo mock, default).
//   - SupabaseInventoryRepository → Supabase/PostgreSQL (modo DB).
//
// El service elige una u otra según el feature flag USE_DB_INVENTORY.
// El contrato de API v1 NO cambia: el modo store replica EXACTAMENTE el
// comportamiento que vivía en routes.ts (items, movimientos, asignaciones).
// Las entidades NUEVAS de la fase (almacenes de primera clase y
// transferencias con ciclo pending→completed) se modelan en ambos modos.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WarehouseItem } from '../../../src/types';
import {
  InventoryAssignmentLog,
  InventoryItemState,
  InventoryMovementLog,
  store,
} from '../../state/store';
import { BadRequestError, ConflictError, NotFoundError } from '../../common/errors';
import { logger } from '../../common/logger';
import { DEFAULT_TENANT_ID } from '../tenancy/types';
import {
  InventoryItemRow,
  InventoryAssignmentRow,
  InventoryMovementRow,
  InventoryTransferRow,
  WarehouseRow,
  rowToAssignment,
  rowToItemView,
  rowToMovement,
  rowToTransfer,
  rowToWarehouse,
  warehousePatchToRow,
  warehouseToRow,
} from './mappers';
import type {
  AddItemInput,
  AssignInput,
  CreateTransferInput,
  CreateWarehouseInput,
  InventoryItemView,
  InventoryTransfer,
  MovementInput,
  UnassignInput,
  Warehouse,
  WarehouseStock,
} from './types';

export interface ItemFilters {
  q?: string;                          // ya normalizado a minúsculas por la ruta
  warehouse?: string;
  operationalStatus?: InventoryItemState['operationalStatus'] | null;
}

export interface ItemStateEnvelope {
  itemId: string;
  itemName: string;
  operationalStatus: InventoryItemState['operationalStatus'];
  assignedToType?: InventoryItemState['assignedToType'];
  assignedToId?: string;
  assignedToLabel?: string;
  updatedAt: string;
}

export interface InventoryRepository {
  // Items
  listItems(filters: ItemFilters): Promise<InventoryItemView[]>;
  getItemView(id: string): Promise<InventoryItemView | null>;
  getItemState(id: string): Promise<ItemStateEnvelope | null>;
  addItem(input: AddItemInput, actorId?: string): Promise<InventoryItemView>;
  updateItem(id: string, patch: Partial<WarehouseItem>): Promise<InventoryItemView | null>;
  setOperationalStatus(id: string, status: InventoryItemState['operationalStatus']): Promise<ItemStateEnvelope | null>;
  applyMovement(input: MovementInput): Promise<InventoryItemView[]>;
  assign(input: AssignInput): Promise<InventoryItemView>;
  unassign(input: UnassignInput): Promise<InventoryItemView>;
  listMovements(itemId?: string): Promise<InventoryMovementLog[]>;
  listAssignments(itemId?: string): Promise<InventoryAssignmentLog[]>;
  // Warehouses
  listWarehouses(): Promise<Warehouse[]>;
  getWarehouse(id: string): Promise<Warehouse | null>;
  createWarehouse(input: CreateWarehouseInput): Promise<Warehouse>;
  updateWarehouse(id: string, patch: Partial<Warehouse>): Promise<Warehouse | null>;
  deleteWarehouse(id: string): Promise<boolean>;
  getWarehouseStock(id: string): Promise<WarehouseStock | null>;
  // Transfers
  listTransfers(tenantId: string): Promise<InventoryTransfer[]>;
  getTransfer(id: string, tenantId: string): Promise<InventoryTransfer | null>;
  createTransfer(input: CreateTransferInput, tenantId: string): Promise<InventoryTransfer>;
  completeTransfer(id: string, tenantId: string): Promise<InventoryTransfer>;
  cancelTransfer(id: string, tenantId: string): Promise<InventoryTransfer>;
}

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 90 + 10)}`;

const requireTransferTenant = (tenantId: string): string => {
  const scoped = String(tenantId || '').trim();
  if (!scoped) throw new BadRequestError('Missing tenant context', 'TENANT_REQUIRED');
  return scoped;
};

// ====================================================================
// Implementación STORE (en memoria). Replica la lógica que vivía en
// routes.ts para que el modo mock sea idéntico al comportamiento previo.
// Items/movimientos/asignaciones/estados viven en `store`. Las entidades
// nuevas (almacenes, transferencias) viven en esta instancia (igual que
// customer-equipment guarda sus reservas localmente).
// ====================================================================
export class StoreInventoryRepository implements InventoryRepository {
  private warehouses: Warehouse[] = [
    { id: 'wh-1', name: 'Principal', type: 'principal', isActive: true, createdAt: '2026-01-01 00:00', updatedAt: '2026-01-01 00:00' },
    { id: 'wh-2', name: 'Torre Alfa', type: 'torre', isActive: true, createdAt: '2026-01-01 00:00', updatedAt: '2026-01-01 00:00' },
    { id: 'wh-3', name: 'Coche Tecnico 1', type: 'vehiculo', isActive: true, createdAt: '2026-01-01 00:00', updatedAt: '2026-01-01 00:00' },
    { id: 'wh-4', name: 'Coche Tecnico 2', type: 'vehiculo', isActive: true, createdAt: '2026-01-01 00:00', updatedAt: '2026-01-01 00:00' },
  ];
  private transfers: InventoryTransfer[] = [];

  private withState(item: WarehouseItem): InventoryItemView {
    const state = store.getInventoryState(item.id);
    return {
      ...item,
      operationalStatus: state.operationalStatus,
      assignedToType: state.assignedToType,
      assignedToId: state.assignedToId,
      assignedToLabel: state.assignedToLabel,
      stateUpdatedAt: state.updatedAt,
    };
  }

  async listItems(filters: ItemFilters): Promise<InventoryItemView[]> {
    const { q, warehouse, operationalStatus } = filters;
    return store.INVENTORY
      .filter((item) => {
        const state = store.getInventoryState(item.id);
        const matchesQuery =
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.model.toLowerCase().includes(q) ||
          item.brand.toLowerCase().includes(q);
        const matchesWarehouse = !warehouse || item.warehouse === warehouse;
        const matchesStatus = !operationalStatus || state.operationalStatus === operationalStatus;
        return matchesQuery && matchesWarehouse && matchesStatus;
      })
      .map((item) => this.withState(item));
  }

  async getItemView(id: string): Promise<InventoryItemView | null> {
    const item = store.INVENTORY.find((row) => row.id === id);
    return item ? this.withState(item) : null;
  }

  async getItemState(id: string): Promise<ItemStateEnvelope | null> {
    const item = store.INVENTORY.find((row) => row.id === id);
    if (!item) return null;
    const state = store.getInventoryState(item.id);
    return { ...state, itemId: item.id, itemName: item.name };
  }

  async addItem(input: AddItemInput, actorId?: string): Promise<InventoryItemView> {
    const initialQty = Number(input.qty) || 0;
    const serialsArr = Array.isArray(input.serials)
      ? input.serials
      : input.serials
        ? String(input.serials).split(',').map((s) => s.trim()).filter(Boolean)
        : [];

    const newItem: WarehouseItem = {
      id: `item-${Date.now()}`,
      name: input.name,
      category: (input.category || 'Other') as WarehouseItem['category'],
      model: input.model,
      brand: input.brand,
      qty: initialQty,
      warehouse: (input.warehouse || 'Principal') as WarehouseItem['warehouse'],
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
      actorId,
    });

    return this.withState(newItem);
  }

  async updateItem(id: string, patch: Partial<WarehouseItem>): Promise<InventoryItemView | null> {
    const index = store.INVENTORY.findIndex((row) => row.id === id);
    if (index === -1) return null;
    store.INVENTORY[index] = { ...store.INVENTORY[index], ...patch };
    return this.withState(store.INVENTORY[index]);
  }

  async setOperationalStatus(id: string, status: InventoryItemState['operationalStatus']): Promise<ItemStateEnvelope | null> {
    const item = store.INVENTORY.find((row) => row.id === id);
    if (!item) return null;
    const state = store.getInventoryState(item.id);
    state.operationalStatus = status;
    state.updatedAt = nowStamp();
    return { ...state, itemId: item.id, itemName: item.name };
  }

  async applyMovement(input: MovementInput): Promise<InventoryItemView[]> {
    const { itemId, type, qty, toWarehouse, reason, actorId } = input;
    const item = store.INVENTORY.find((i) => i.id === itemId);
    if (!item) throw new NotFoundError('Inventory item not found');

    const originalWarehouse = item.warehouse;

    if (type === 'in') {
      item.qty += qty;
      const state = store.getInventoryState(item.id);
      if (state.operationalStatus === 'Perdido' || state.operationalStatus === 'Baja') {
        state.operationalStatus = 'Disponible';
      }
      state.updatedAt = nowStamp();
    } else if (type === 'out') {
      if (item.qty < qty) throw new BadRequestError('Insufficient stock', 'INSUFFICIENT_STOCK');
      item.qty -= qty;
    } else if (type === 'transfer') {
      if (!toWarehouse) throw new BadRequestError('toWarehouse is required for transfer movements', 'MISSING_FIELD');
      if (item.qty < qty) throw new BadRequestError('Insufficient stock for transfer', 'INSUFFICIENT_STOCK');
      item.qty -= qty;
      const destItem = store.INVENTORY.find((i) => i.name === item.name && i.warehouse === toWarehouse);
      if (destItem) {
        destItem.qty += qty;
      } else {
        const createdItem: WarehouseItem = {
          id: 'item-' + Date.now(),
          name: item.name,
          category: item.category,
          model: item.model,
          brand: item.brand,
          qty,
          warehouse: toWarehouse as WarehouseItem['warehouse'],
          serials: [],
        };
        store.INVENTORY.push(createdItem);
        store.getInventoryState(createdItem.id);
      }
    } else {
      throw new BadRequestError('Invalid movement type', 'INVALID_ENUM');
    }

    store.logInventoryMovement({
      itemId: item.id,
      itemName: item.name,
      type,
      qty,
      fromWarehouse: originalWarehouse,
      toWarehouse: type === 'transfer' ? toWarehouse : undefined,
      reason,
      actorId,
    });

    return store.INVENTORY.map((i) => this.withState(i));
  }

  async assign(input: AssignInput): Promise<InventoryItemView> {
    const item = store.INVENTORY.find((row) => row.id === input.itemId);
    if (!item) throw new NotFoundError('Inventory item not found');
    if (item.qty < input.qty) throw new BadRequestError('Insufficient stock for assignment', 'INSUFFICIENT_STOCK');

    item.qty -= input.qty;
    const state = store.getInventoryState(item.id);
    state.operationalStatus = 'Instalado';
    state.assignedToType = input.targetType;
    state.assignedToId = input.targetId;
    state.assignedToLabel = input.targetLabel;
    state.updatedAt = nowStamp();

    store.logInventoryAssignment({
      itemId: item.id,
      itemName: item.name,
      action: 'assign',
      qty: input.qty,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      notes: input.notes,
      actorId: input.actorId,
    });
    store.logInventoryMovement({
      itemId: item.id,
      itemName: item.name,
      type: 'out',
      qty: input.qty,
      fromWarehouse: item.warehouse,
      reason: `Asignacion a ${input.targetType}:${input.targetLabel}`,
      actorId: input.actorId,
    });

    return this.withState(item);
  }

  async unassign(input: UnassignInput): Promise<InventoryItemView> {
    const item = store.INVENTORY.find((row) => row.id === input.itemId);
    if (!item) throw new NotFoundError('Inventory item not found');

    item.qty += input.qty;
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
      qty: input.qty,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      notes: input.notes,
      actorId: input.actorId,
    });
    store.logInventoryMovement({
      itemId: item.id,
      itemName: item.name,
      type: 'in',
      qty: input.qty,
      toWarehouse: item.warehouse,
      reason: 'Retorno de asignacion tecnica',
      actorId: input.actorId,
    });

    return this.withState(item);
  }

  async listMovements(itemId?: string): Promise<InventoryMovementLog[]> {
    return itemId
      ? store.INVENTORY_MOVEMENTS.filter((row) => row.itemId === itemId)
      : store.INVENTORY_MOVEMENTS;
  }

  async listAssignments(itemId?: string): Promise<InventoryAssignmentLog[]> {
    return itemId
      ? store.INVENTORY_ASSIGNMENTS.filter((row) => row.itemId === itemId)
      : store.INVENTORY_ASSIGNMENTS;
  }

  // --- Warehouses ---------------------------------------------------
  async listWarehouses(): Promise<Warehouse[]> {
    return this.warehouses.map((w) => ({ ...w }));
  }

  async getWarehouse(id: string): Promise<Warehouse | null> {
    return this.warehouses.find((w) => w.id === id) ?? null;
  }

  async createWarehouse(input: CreateWarehouseInput): Promise<Warehouse> {
    if (this.warehouses.some((w) => w.name.toLowerCase() === input.name.trim().toLowerCase())) {
      throw new ConflictError('Warehouse name already exists', 'DUPLICATE_NAME');
    }
    const wh: Warehouse = {
      id: uid('wh'),
      ...(input.code ? { code: input.code } : {}),
      name: input.name.trim(),
      type: input.type ?? 'otro',
      ...(input.location ? { location: input.location } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      isActive: input.isActive ?? true,
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
    };
    this.warehouses.unshift(wh);
    return { ...wh };
  }

  async updateWarehouse(id: string, patch: Partial<Warehouse>): Promise<Warehouse | null> {
    const index = this.warehouses.findIndex((w) => w.id === id);
    if (index === -1) return null;
    if (patch.name) {
      const dup = this.warehouses.some(
        (w) => w.id !== id && w.name.toLowerCase() === String(patch.name).trim().toLowerCase(),
      );
      if (dup) throw new ConflictError('Warehouse name already exists', 'DUPLICATE_NAME');
    }
    this.warehouses[index] = { ...this.warehouses[index], ...patch, updatedAt: nowStamp() };
    return { ...this.warehouses[index] };
  }

  async deleteWarehouse(id: string): Promise<boolean> {
    const wh = this.warehouses.find((w) => w.id === id);
    if (!wh) return false;
    const inUse = store.INVENTORY.some((i) => i.warehouse === wh.name && i.qty > 0);
    if (inUse) throw new ConflictError('Warehouse is in use by at least one item', 'IN_USE');
    this.warehouses = this.warehouses.filter((w) => w.id !== id);
    return true;
  }

  async getWarehouseStock(id: string): Promise<WarehouseStock | null> {
    const wh = this.warehouses.find((w) => w.id === id);
    if (!wh) return null;
    const items = store.INVENTORY.filter((i) => i.warehouse === wh.name);
    return {
      warehouse: wh.name,
      totalUnits: items.reduce((acc, i) => acc + i.qty, 0),
      distinctItems: items.length,
      items: items.map((i) => ({
        itemId: i.id,
        name: i.name,
        category: i.category,
        model: i.model,
        brand: i.brand,
        qty: i.qty,
      })),
    };
  }

  // --- Transfers ----------------------------------------------------
  async listTransfers(tenantId: string): Promise<InventoryTransfer[]> {
    const scoped = requireTransferTenant(tenantId);
    return this.transfers.filter((t) => t.tenantId === scoped).map((t) => ({ ...t }));
  }

  async getTransfer(id: string, tenantId: string): Promise<InventoryTransfer | null> {
    const scoped = requireTransferTenant(tenantId);
    const transfer = this.transfers.find((t) => t.id === id && t.tenantId === scoped);
    return transfer ? { ...transfer } : null;
  }

  async createTransfer(input: CreateTransferInput, tenantId: string): Promise<InventoryTransfer> {
    const scoped = requireTransferTenant(tenantId);
    // El store legacy sólo contiene relaciones del tenant-default. Para otros
    // tenants falla cerrado hasta que items/warehouses tengan store propio.
    if (scoped !== DEFAULT_TENANT_ID) throw new NotFoundError('Inventory item not found');
    const item = store.INVENTORY.find((i) => i.id === input.itemId);
    if (!item) throw new NotFoundError('Inventory item not found');
    if (!this.warehouses.some((warehouse) => warehouse.name === item.warehouse)) {
      throw new NotFoundError('Origin warehouse not found');
    }
    if (!this.warehouses.some((warehouse) => warehouse.name === input.toWarehouse)) {
      throw new NotFoundError('Destination warehouse not found');
    }
    if (input.toWarehouse === item.warehouse) {
      throw new BadRequestError('Origin and destination warehouses must differ', 'SAME_WAREHOUSE');
    }
    if (item.qty < input.qty) throw new BadRequestError('Insufficient stock for transfer', 'INSUFFICIENT_STOCK');

    const transfer: InventoryTransfer = {
      id: uid('tr'),
      tenantId: scoped,
      itemId: item.id,
      itemName: item.name,
      qty: input.qty,
      fromWarehouse: item.warehouse,
      toWarehouse: input.toWarehouse,
      status: 'pending',
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.actorId ? { actorId: input.actorId } : {}),
      createdAt: nowStamp(),
    };
    this.transfers.unshift(transfer);
    return { ...transfer };
  }

  async completeTransfer(id: string, tenantId: string): Promise<InventoryTransfer> {
    const scoped = requireTransferTenant(tenantId);
    const transfer = this.transfers.find((t) => t.id === id && t.tenantId === scoped);
    if (!transfer) throw new NotFoundError('Transfer not found');
    if (transfer.status !== 'pending') throw new BadRequestError('Transfer is not pending', 'INVALID_STATE');
    if (scoped !== DEFAULT_TENANT_ID) throw new NotFoundError('Inventory item not found');

    // Mueve el stock al completar (mismo efecto que un movimiento de traspaso).
    await this.applyMovement({
      itemId: transfer.itemId,
      type: 'transfer',
      qty: transfer.qty,
      toWarehouse: transfer.toWarehouse,
      reason: transfer.reason ?? `Transferencia ${transfer.id}`,
      actorId: transfer.actorId,
    });

    transfer.status = 'completed';
    transfer.completedAt = nowStamp();
    return { ...transfer };
  }

  async cancelTransfer(id: string, tenantId: string): Promise<InventoryTransfer> {
    const scoped = requireTransferTenant(tenantId);
    const transfer = this.transfers.find((t) => t.id === id && t.tenantId === scoped);
    if (!transfer) throw new NotFoundError('Transfer not found');
    if (transfer.status !== 'pending') throw new BadRequestError('Transfer is not pending', 'INVALID_STATE');
    transfer.status = 'cancelled';
    transfer.cancelledAt = nowStamp();
    return { ...transfer };
  }
}

// ====================================================================
// Implementación DB (Supabase / PostgreSQL). Usa el cliente admin
// (service-role) — SIEMPRE del lado servidor, nunca expuesto al frontend.
//
// Nota de atomicidad: las mutaciones compuestas (movimiento/transferencia)
// hacen read-modify-write secuencial. Para v1 es aceptable (lo valida Hermes
// en staging); una transacción real requeriría una RPC y queda fuera de alcance.
// ====================================================================
const ITEMS = 'inventory_items';
const MOVEMENTS = 'inventory_movements';
const ASSIGNMENTS = 'inventory_assignments';
const TRANSFERS = 'inventory_transfers';
const WAREHOUSES = 'warehouses';

const databaseErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.message, record.code, record.details, record.hint]
      .map((value) => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean);
    if (parts.length) return parts.join(' | ');
  }
  return String(error);
};

const fail = (context: string, error: unknown): never => {
  const message = databaseErrorMessage(error);
  logger.error(`Supabase inventory repository error: ${context}`, { message });
  throw new Error(`Inventory DB error (${context}): ${message}`);
};

export class SupabaseInventoryRepository implements InventoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async getItemRow(id: string, tenantId?: string): Promise<InventoryItemRow | null> {
    let query = this.client.from(ITEMS).select('*').eq('id', id);
    if (tenantId !== undefined) query = query.eq('tenant_id', requireTransferTenant(tenantId));
    const { data, error } = await query.maybeSingle();
    if (error) return fail('getItemRow', error);
    return (data as InventoryItemRow) ?? null;
  }

  private async hasWarehouse(name: string, tenantId: string): Promise<boolean> {
    const scoped = requireTransferTenant(tenantId);
    const { data, error } = await this.client
      .from(WAREHOUSES)
      .select('id')
      .eq('name', name)
      .eq('tenant_id', scoped)
      .limit(1)
      .maybeSingle();
    if (error) return fail('hasWarehouse', error);
    return Boolean(data);
  }

  private async insertMovement(row: Omit<InventoryMovementRow, 'created_at'>): Promise<void> {
    const { error } = await this.client.from(MOVEMENTS).insert(row);
    if (error) fail('insertMovement', error);
  }

  async listItems(filters: ItemFilters): Promise<InventoryItemView[]> {
    let query = this.client.from(ITEMS).select('*');
    if (filters.warehouse) query = query.eq('warehouse', filters.warehouse);
    if (filters.operationalStatus) query = query.eq('operational_status', filters.operationalStatus);
    if (filters.q) {
      query = query.or(`name.ilike.%${filters.q}%,model.ilike.%${filters.q}%,brand.ilike.%${filters.q}%`);
    }
    const { data, error } = await query;
    if (error) return fail('listItems', error);
    return (data as InventoryItemRow[]).map(rowToItemView);
  }

  async getItemView(id: string): Promise<InventoryItemView | null> {
    const row = await this.getItemRow(id);
    return row ? rowToItemView(row) : null;
  }

  async getItemState(id: string): Promise<ItemStateEnvelope | null> {
    const row = await this.getItemRow(id);
    if (!row) return null;
    return {
      itemId: row.id,
      itemName: row.name,
      operationalStatus: row.operational_status,
      ...(row.assigned_to_type ? { assignedToType: row.assigned_to_type } : {}),
      ...(row.assigned_to_id ? { assignedToId: row.assigned_to_id } : {}),
      ...(row.assigned_to_label ? { assignedToLabel: row.assigned_to_label } : {}),
      updatedAt: row.updated_at,
    };
  }

  async addItem(input: AddItemInput, actorId?: string): Promise<InventoryItemView> {
    const initialQty = Number(input.qty) || 0;
    const serialsArr = Array.isArray(input.serials)
      ? input.serials
      : input.serials
        ? String(input.serials).split(',').map((s) => s.trim()).filter(Boolean)
        : [];
    const warehouse = input.warehouse || 'Principal';
    const id = `item-${Date.now()}`;

    const { data, error } = await this.client
      .from(ITEMS)
      .insert({
        id,
        name: input.name,
        category: input.category || 'Other',
        model: input.model,
        brand: input.brand,
        warehouse,
        qty: initialQty,
        serials: serialsArr,
        operational_status: 'Disponible',
        assigned_to_type: 'warehouse',
        assigned_to_label: warehouse,
      })
      .select('*')
      .single();
    if (error) return fail('addItem', error);

    await this.insertMovement({
      id: uid('mov'),
      item_id: id,
      item_name: input.name,
      type: 'in',
      qty: initialQty || 1,
      from_warehouse: null,
      to_warehouse: warehouse,
      reason: 'Alta inicial de articulo',
      actor_id: actorId ?? null,
    });

    return rowToItemView(data as InventoryItemRow);
  }

  async updateItem(id: string, patch: Partial<WarehouseItem>): Promise<InventoryItemView | null> {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.model !== undefined) row.model = patch.model;
    if (patch.brand !== undefined) row.brand = patch.brand;
    if (patch.warehouse !== undefined) row.warehouse = patch.warehouse;
    if (patch.serials !== undefined) row.serials = patch.serials;
    if (Object.keys(row).length === 0) return this.getItemView(id);

    const { data, error } = await this.client.from(ITEMS).update(row).eq('id', id).select('*').maybeSingle();
    if (error) return fail('updateItem', error);
    return data ? rowToItemView(data as InventoryItemRow) : null;
  }

  async setOperationalStatus(id: string, status: InventoryItemState['operationalStatus']): Promise<ItemStateEnvelope | null> {
    const { data, error } = await this.client
      .from(ITEMS)
      .update({ operational_status: status })
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) return fail('setOperationalStatus', error);
    if (!data) return null;
    const row = data as InventoryItemRow;
    return {
      itemId: row.id,
      itemName: row.name,
      operationalStatus: row.operational_status,
      ...(row.assigned_to_type ? { assignedToType: row.assigned_to_type } : {}),
      ...(row.assigned_to_id ? { assignedToId: row.assigned_to_id } : {}),
      ...(row.assigned_to_label ? { assignedToLabel: row.assigned_to_label } : {}),
      updatedAt: row.updated_at,
    };
  }

  async applyMovement(input: MovementInput, tenantId?: string): Promise<InventoryItemView[]> {
    const { itemId, type, qty, toWarehouse, reason, actorId } = input;
    const scoped = tenantId === undefined ? undefined : requireTransferTenant(tenantId);
    const item = await this.getItemRow(itemId, scoped);
    if (!item) throw new NotFoundError('Inventory item not found');

    if (type === 'in') {
      const nextStatus =
        item.operational_status === 'Perdido' || item.operational_status === 'Baja'
          ? 'Disponible'
          : item.operational_status;
      let query = this.client
        .from(ITEMS)
        .update({ qty: item.qty + qty, operational_status: nextStatus })
        .eq('id', itemId);
      if (scoped) query = query.eq('tenant_id', scoped);
      const { error } = await query;
      if (error) fail('applyMovement.in', error);
    } else if (type === 'out') {
      if (item.qty < qty) throw new BadRequestError('Insufficient stock', 'INSUFFICIENT_STOCK');
      let query = this.client.from(ITEMS).update({ qty: item.qty - qty }).eq('id', itemId);
      if (scoped) query = query.eq('tenant_id', scoped);
      const { error } = await query;
      if (error) fail('applyMovement.out', error);
    } else if (type === 'transfer') {
      if (!toWarehouse) throw new BadRequestError('toWarehouse is required for transfer movements', 'MISSING_FIELD');
      if (item.qty < qty) throw new BadRequestError('Insufficient stock for transfer', 'INSUFFICIENT_STOCK');
      let sourceUpdate = this.client.from(ITEMS).update({ qty: item.qty - qty }).eq('id', itemId);
      if (scoped) sourceUpdate = sourceUpdate.eq('tenant_id', scoped);
      const upd = await sourceUpdate;
      if (upd.error) fail('applyMovement.transfer.src', upd.error);

      let destinationQuery = this.client
        .from(ITEMS)
        .select('*')
        .eq('name', item.name)
        .eq('warehouse', toWarehouse);
      if (scoped) destinationQuery = destinationQuery.eq('tenant_id', scoped);
      const { data: dest, error: destErr } = await destinationQuery.limit(1).maybeSingle();
      if (destErr) fail('applyMovement.transfer.dest', destErr);
      if (dest) {
        const destRow = dest as InventoryItemRow;
        let destinationUpdate = this.client.from(ITEMS).update({ qty: destRow.qty + qty }).eq('id', destRow.id);
        if (scoped) destinationUpdate = destinationUpdate.eq('tenant_id', scoped);
        const e = await destinationUpdate;
        if (e.error) fail('applyMovement.transfer.destUpdate', e.error);
      } else {
        const e = await this.client.from(ITEMS).insert({
          id: 'item-' + Date.now(),
          name: item.name,
          category: item.category,
          model: item.model,
          brand: item.brand,
          warehouse: toWarehouse,
          qty,
          serials: [],
          operational_status: 'Disponible',
          assigned_to_type: 'warehouse',
          assigned_to_label: toWarehouse,
          ...(scoped ? { tenant_id: scoped } : {}),
        });
        if (e.error) fail('applyMovement.transfer.destInsert', e.error);
      }
    } else {
      throw new BadRequestError('Invalid movement type', 'INVALID_ENUM');
    }

    await this.insertMovement({
      id: uid('mov'),
      item_id: item.id,
      item_name: item.name,
      type,
      qty,
      from_warehouse: item.warehouse,
      to_warehouse: type === 'transfer' ? (toWarehouse ?? null) : null,
      reason: reason ?? null,
      actor_id: actorId ?? null,
      ...(scoped ? { tenant_id: scoped } : {}),
    });

    if (scoped) {
      const { data, error } = await this.client.from(ITEMS).select('*').eq('tenant_id', scoped);
      if (error) return fail('applyMovement.listScoped', error);
      return (data as InventoryItemRow[]).map(rowToItemView);
    }
    return this.listItems({});
  }

  async assign(input: AssignInput): Promise<InventoryItemView> {
    const item = await this.getItemRow(input.itemId);
    if (!item) throw new NotFoundError('Inventory item not found');
    if (item.qty < input.qty) throw new BadRequestError('Insufficient stock for assignment', 'INSUFFICIENT_STOCK');

    const { data, error } = await this.client
      .from(ITEMS)
      .update({
        qty: item.qty - input.qty,
        operational_status: 'Instalado',
        assigned_to_type: input.targetType,
        assigned_to_id: input.targetId,
        assigned_to_label: input.targetLabel,
      })
      .eq('id', input.itemId)
      .select('*')
      .single();
    if (error) return fail('assign', error);

    const { error: aErr } = await this.client.from(ASSIGNMENTS).insert({
      id: uid('asg'),
      item_id: item.id,
      item_name: item.name,
      action: 'assign',
      qty: input.qty,
      target_type: input.targetType,
      target_id: input.targetId,
      target_label: input.targetLabel,
      notes: input.notes ?? null,
      actor_id: input.actorId ?? null,
    });
    if (aErr) fail('assign.log', aErr);
    await this.insertMovement({
      id: uid('mov'),
      item_id: item.id,
      item_name: item.name,
      type: 'out',
      qty: input.qty,
      from_warehouse: item.warehouse,
      to_warehouse: null,
      reason: `Asignacion a ${input.targetType}:${input.targetLabel}`,
      actor_id: input.actorId ?? null,
    });

    return rowToItemView(data as InventoryItemRow);
  }

  async unassign(input: UnassignInput): Promise<InventoryItemView> {
    const item = await this.getItemRow(input.itemId);
    if (!item) throw new NotFoundError('Inventory item not found');

    const { data, error } = await this.client
      .from(ITEMS)
      .update({
        qty: item.qty + input.qty,
        operational_status: 'Disponible',
        assigned_to_type: 'warehouse',
        assigned_to_id: 'principal',
        assigned_to_label: item.warehouse,
      })
      .eq('id', input.itemId)
      .select('*')
      .single();
    if (error) return fail('unassign', error);

    const { error: aErr } = await this.client.from(ASSIGNMENTS).insert({
      id: uid('asg'),
      item_id: item.id,
      item_name: item.name,
      action: 'unassign',
      qty: input.qty,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      notes: input.notes ?? null,
      actor_id: input.actorId ?? null,
    });
    if (aErr) fail('unassign.log', aErr);
    await this.insertMovement({
      id: uid('mov'),
      item_id: item.id,
      item_name: item.name,
      type: 'in',
      qty: input.qty,
      from_warehouse: null,
      to_warehouse: item.warehouse,
      reason: 'Retorno de asignacion tecnica',
      actor_id: input.actorId ?? null,
    });

    return rowToItemView(data as InventoryItemRow);
  }

  async listMovements(itemId?: string): Promise<InventoryMovementLog[]> {
    let query = this.client.from(MOVEMENTS).select('*').order('created_at', { ascending: false });
    if (itemId) query = query.eq('item_id', itemId);
    const { data, error } = await query;
    if (error) return fail('listMovements', error);
    return (data as InventoryMovementRow[]).map(rowToMovement);
  }

  async listAssignments(itemId?: string): Promise<InventoryAssignmentLog[]> {
    let query = this.client.from(ASSIGNMENTS).select('*').order('created_at', { ascending: false });
    if (itemId) query = query.eq('item_id', itemId);
    const { data, error } = await query;
    if (error) return fail('listAssignments', error);
    return (data as InventoryAssignmentRow[]).map(rowToAssignment);
  }

  // --- Warehouses ---------------------------------------------------
  async listWarehouses(): Promise<Warehouse[]> {
    const { data, error } = await this.client.from(WAREHOUSES).select('*').order('name', { ascending: true });
    if (error) return fail('listWarehouses', error);
    return (data as WarehouseRow[]).map(rowToWarehouse);
  }

  async getWarehouse(id: string): Promise<Warehouse | null> {
    const { data, error } = await this.client.from(WAREHOUSES).select('*').eq('id', id).maybeSingle();
    if (error) return fail('getWarehouse', error);
    return data ? rowToWarehouse(data as WarehouseRow) : null;
  }

  async createWarehouse(input: CreateWarehouseInput): Promise<Warehouse> {
    const now = new Date().toISOString();
    const wh: Warehouse = {
      id: uid('wh'),
      ...(input.code ? { code: input.code } : {}),
      name: input.name.trim(),
      type: input.type ?? 'otro',
      ...(input.location ? { location: input.location } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    const { data, error } = await this.client.from(WAREHOUSES).insert(warehouseToRow(wh)).select('*').single();
    if (error) {
      if (String(error.code) === '23505') throw new ConflictError('Warehouse name already exists', 'DUPLICATE_NAME');
      return fail('createWarehouse', error);
    }
    return rowToWarehouse(data as WarehouseRow);
  }

  async updateWarehouse(id: string, patch: Partial<Warehouse>): Promise<Warehouse | null> {
    const row = warehousePatchToRow(patch);
    if (Object.keys(row).length === 0) return this.getWarehouse(id);
    const { data, error } = await this.client.from(WAREHOUSES).update(row).eq('id', id).select('*').maybeSingle();
    if (error) {
      if (String(error.code) === '23505') throw new ConflictError('Warehouse name already exists', 'DUPLICATE_NAME');
      return fail('updateWarehouse', error);
    }
    return data ? rowToWarehouse(data as WarehouseRow) : null;
  }

  async deleteWarehouse(id: string): Promise<boolean> {
    const wh = await this.getWarehouse(id);
    if (!wh) return false;
    const { count, error: cErr } = await this.client
      .from(ITEMS)
      .select('id', { count: 'exact', head: true })
      .eq('warehouse', wh.name)
      .gt('qty', 0);
    if (cErr) fail('deleteWarehouse.count', cErr);
    if ((count ?? 0) > 0) throw new ConflictError('Warehouse is in use by at least one item', 'IN_USE');
    const { error } = await this.client.from(WAREHOUSES).delete().eq('id', id);
    if (error) return fail('deleteWarehouse', error);
    return true;
  }

  async getWarehouseStock(id: string): Promise<WarehouseStock | null> {
    const wh = await this.getWarehouse(id);
    if (!wh) return null;
    const { data, error } = await this.client.from(ITEMS).select('*').eq('warehouse', wh.name);
    if (error) return fail('getWarehouseStock', error);
    const items = (data as InventoryItemRow[]) ?? [];
    return {
      warehouse: wh.name,
      totalUnits: items.reduce((acc, i) => acc + i.qty, 0),
      distinctItems: items.length,
      items: items.map((i) => ({
        itemId: i.id,
        name: i.name,
        category: i.category,
        model: i.model,
        brand: i.brand,
        qty: i.qty,
      })),
    };
  }

  // --- Transfers ----------------------------------------------------
  async listTransfers(tenantId: string): Promise<InventoryTransfer[]> {
    const scoped = requireTransferTenant(tenantId);
    const { data, error } = await this.client.from(TRANSFERS).select('*').eq('tenant_id', scoped)
      .order('created_at', { ascending: false });
    if (error) return fail('listTransfers', error);
    return (data as InventoryTransferRow[]).map(rowToTransfer);
  }

  async getTransfer(id: string, tenantId: string): Promise<InventoryTransfer | null> {
    const scoped = requireTransferTenant(tenantId);
    const { data, error } = await this.client.from(TRANSFERS).select('*').eq('id', id)
      .eq('tenant_id', scoped).maybeSingle();
    if (error) return fail('getTransfer', error);
    return data ? rowToTransfer(data as InventoryTransferRow) : null;
  }

  async createTransfer(input: CreateTransferInput, tenantId: string): Promise<InventoryTransfer> {
    const scoped = requireTransferTenant(tenantId);
    const item = await this.getItemRow(input.itemId, scoped);
    if (!item) throw new NotFoundError('Inventory item not found');
    if (!(await this.hasWarehouse(item.warehouse, scoped))) {
      throw new NotFoundError('Origin warehouse not found');
    }
    if (!(await this.hasWarehouse(input.toWarehouse, scoped))) {
      throw new NotFoundError('Destination warehouse not found');
    }
    if (input.toWarehouse === item.warehouse) {
      throw new BadRequestError('Origin and destination warehouses must differ', 'SAME_WAREHOUSE');
    }
    if (item.qty < input.qty) throw new BadRequestError('Insufficient stock for transfer', 'INSUFFICIENT_STOCK');

    const { data, error } = await this.client
      .from(TRANSFERS)
      .insert({
        id: uid('tr'),
        tenant_id: scoped,
        item_id: item.id,
        item_name: item.name,
        qty: input.qty,
        from_warehouse: item.warehouse,
        to_warehouse: input.toWarehouse,
        status: 'pending',
        reason: input.reason ?? null,
        actor_id: input.actorId ?? null,
      })
      .select('*')
      .single();
    if (error) return fail('createTransfer', error);
    return rowToTransfer(data as InventoryTransferRow);
  }

  async completeTransfer(id: string, tenantId: string): Promise<InventoryTransfer> {
    const scoped = requireTransferTenant(tenantId);
    const transfer = await this.getTransfer(id, scoped);
    if (!transfer) throw new NotFoundError('Transfer not found');
    if (transfer.status !== 'pending') throw new BadRequestError('Transfer is not pending', 'INVALID_STATE');

    await this.applyMovement({
      itemId: transfer.itemId,
      type: 'transfer',
      qty: transfer.qty,
      toWarehouse: transfer.toWarehouse,
      reason: transfer.reason ?? `Transferencia ${transfer.id}`,
      actorId: transfer.actorId,
    }, scoped);

    const { data, error } = await this.client
      .from(TRANSFERS)
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', scoped)
      .select('*')
      .single();
    if (error) return fail('completeTransfer', error);
    return rowToTransfer(data as InventoryTransferRow);
  }

  async cancelTransfer(id: string, tenantId: string): Promise<InventoryTransfer> {
    const scoped = requireTransferTenant(tenantId);
    const transfer = await this.getTransfer(id, scoped);
    if (!transfer) throw new NotFoundError('Transfer not found');
    if (transfer.status !== 'pending') throw new BadRequestError('Transfer is not pending', 'INVALID_STATE');
    const { data, error } = await this.client
      .from(TRANSFERS)
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', scoped)
      .select('*')
      .single();
    if (error) return fail('cancelTransfer', error);
    return rowToTransfer(data as InventoryTransferRow);
  }
}
