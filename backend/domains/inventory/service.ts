// ====================================================================
// Service del dominio Inventario ERP (Fase 5.1).
//
// Concentra validaciones y reglas de negocio del inventario, y delega la
// persistencia al repository (store mock o Supabase, según USE_DB_INVENTORY).
// No conoce Express (sin req/res): lógica pura y testeable.
//
// El contrato de API v1 se preserva: el modo store replica el comportamiento
// que vivía en routes.ts. Las entidades nuevas (almacenes de primera clase y
// transferencias con ciclo de vida) se exponen de forma aditiva.
// ====================================================================

import type { WarehouseItem } from '../../../src/types';
import type { InventoryItemState } from '../../state/store';
import { isDomainOnDb } from '../../config/feature-flags';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';
import { BadRequestError } from '../../common/errors';
import { logger } from '../../common/logger';
import {
  InventoryRepository,
  ItemFilters,
  ItemStateEnvelope,
  StoreInventoryRepository,
  SupabaseInventoryRepository,
} from './repository';
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
  WarehouseType,
} from './types';

const OP_STATUSES: InventoryItemState['operationalStatus'][] = [
  'Disponible', 'Instalado', 'En reparacion', 'Danado', 'Perdido', 'Baja',
];
const WAREHOUSE_TYPES: WarehouseType[] = ['principal', 'torre', 'vehiculo', 'tecnico', 'otro'];

/** Normaliza el operationalStatus desde un string laxo de query/body. Devuelve null si inválido. */
export const parseOperationalStatus = (value: unknown): InventoryItemState['operationalStatus'] | null => {
  const raw = String(value || '').trim().toLowerCase();
  const match = OP_STATUSES.find((s) => s.toLowerCase() === raw);
  return match ?? null;
};

const parseWarehouseType = (value: unknown): WarehouseType | null => {
  const raw = String(value || '').trim().toLowerCase();
  return (WAREHOUSE_TYPES as string[]).includes(raw) ? (raw as WarehouseType) : null;
};

const positiveQty = (value: unknown, field = 'qty'): number => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestError(`Invalid ${field}. Must be greater than 0.`, 'INVALID_QTY');
  }
  return n;
};

export class InventoryService {
  constructor(private readonly repo: InventoryRepository) {}

  // --- Items --------------------------------------------------------
  listItems(filters: ItemFilters): Promise<InventoryItemView[]> {
    return this.repo.listItems(filters);
  }

  getItemState(id: string): Promise<ItemStateEnvelope | null> {
    return this.repo.getItemState(id);
  }

  addItem(input: AddItemInput, actorId?: string): Promise<InventoryItemView> {
    if (!input.name || !input.model || !input.brand) {
      throw new BadRequestError('Missing required fields: name, model, and brand are required', 'MISSING_FIELD');
    }
    return this.repo.addItem(input, actorId);
  }

  updateItem(id: string, patch: Partial<WarehouseItem>): Promise<InventoryItemView | null> {
    return this.repo.updateItem(id, patch);
  }

  setOperationalStatus(id: string, statusRaw: unknown): Promise<ItemStateEnvelope | null> {
    const status = parseOperationalStatus(statusRaw);
    if (!status) throw new BadRequestError('Invalid operationalStatus', 'INVALID_ENUM');
    return this.repo.setOperationalStatus(id, status);
  }

  applyMovement(input: Omit<MovementInput, 'qty'> & { qty: unknown }): Promise<InventoryItemView[]> {
    const qty = positiveQty(input.qty);
    return this.repo.applyMovement({ ...input, qty });
  }

  assign(input: Omit<AssignInput, 'qty'> & { qty: unknown }): Promise<InventoryItemView> {
    const qty = positiveQty(input.qty);
    if (!input.targetType || !input.targetId || !input.targetLabel) {
      throw new BadRequestError('Missing assignment target fields: targetType, targetId, targetLabel', 'MISSING_FIELD');
    }
    return this.repo.assign({ ...input, qty });
  }

  unassign(input: Omit<UnassignInput, 'qty'> & { qty: unknown }): Promise<InventoryItemView> {
    const qty = positiveQty(input.qty);
    return this.repo.unassign({ ...input, qty });
  }

  listMovements(itemId?: string) {
    return this.repo.listMovements(itemId);
  }

  listAssignments(itemId?: string) {
    return this.repo.listAssignments(itemId);
  }

  // --- Warehouses ---------------------------------------------------
  listWarehouses(): Promise<Warehouse[]> {
    return this.repo.listWarehouses();
  }

  getWarehouse(id: string): Promise<Warehouse | null> {
    return this.repo.getWarehouse(id);
  }

  createWarehouse(input: CreateWarehouseInput): Promise<Warehouse> {
    if (!input.name || !String(input.name).trim()) {
      throw new BadRequestError('Missing required field: name', 'MISSING_FIELD');
    }
    if (input.type !== undefined && parseWarehouseType(input.type) === null) {
      throw new BadRequestError('Invalid warehouse type', 'INVALID_ENUM');
    }
    return this.repo.createWarehouse(input);
  }

  updateWarehouse(id: string, patch: Partial<Warehouse>): Promise<Warehouse | null> {
    if (patch.type !== undefined && parseWarehouseType(patch.type) === null) {
      throw new BadRequestError('Invalid warehouse type', 'INVALID_ENUM');
    }
    return this.repo.updateWarehouse(id, patch);
  }

  deleteWarehouse(id: string): Promise<boolean> {
    return this.repo.deleteWarehouse(id);
  }

  getWarehouseStock(id: string): Promise<WarehouseStock | null> {
    return this.repo.getWarehouseStock(id);
  }

  // --- Transfers ----------------------------------------------------
  listTransfers(): Promise<InventoryTransfer[]> {
    return this.repo.listTransfers();
  }

  getTransfer(id: string): Promise<InventoryTransfer | null> {
    return this.repo.getTransfer(id);
  }

  createTransfer(input: Omit<CreateTransferInput, 'qty'> & { qty: unknown }): Promise<InventoryTransfer> {
    const qty = positiveQty(input.qty);
    if (!input.itemId || !input.toWarehouse) {
      throw new BadRequestError('Missing required fields: itemId, toWarehouse', 'MISSING_FIELD');
    }
    return this.repo.createTransfer({ ...input, qty });
  }

  completeTransfer(id: string): Promise<InventoryTransfer> {
    return this.repo.completeTransfer(id);
  }

  cancelTransfer(id: string): Promise<InventoryTransfer> {
    return this.repo.cancelTransfer(id);
  }
}

// --------------------------------------------------------------------
// Factoría: elige el repository según el feature flag (singleton).
// Falla rápido y claro si se pide modo DB sin Supabase configurado.
// --------------------------------------------------------------------
let singleton: InventoryService | null = null;

const buildService = (): InventoryService => {
  if (isDomainOnDb('inventory')) {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      throw new Error(
        'USE_DB_INVENTORY=true pero Supabase no está configurado. ' +
          'Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, o vuelve a USE_DB_INVENTORY=false.',
      );
    }
    logger.info('Inventory domain: persistencia = Supabase (USE_DB_INVENTORY=true)');
    return new InventoryService(new SupabaseInventoryRepository(supabaseAdmin));
  }
  logger.info('Inventory domain: persistencia = store en memoria (USE_DB_INVENTORY=false)');
  return new InventoryService(new StoreInventoryRepository());
};

export const getInventoryService = (): InventoryService => {
  if (!singleton) singleton = buildService();
  return singleton;
};

/** Sólo para tests: fuerza reconstruir el service tras cambiar el flag. */
export const resetInventoryService = (): void => {
  singleton = null;
};
