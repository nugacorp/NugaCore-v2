import { isDomainOnDb } from '../../config/feature-flags';
import { BadRequestError, NotFoundError } from '../../common/errors';
import { isSupabaseAdminConfigured, supabaseAdmin } from '../../services/supabase-admin';

export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  notes?: string;
  isActive: boolean;
}

export interface PurchaseOrderLine {
  id: string;
  itemName: string;
  qty: number;
  unitCostCents: number;
  inventoryItemId?: string;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName?: string;
  status: 'draft' | 'ordered' | 'received' | 'canceled';
  totalCents: number;
  currency: string;
  orderedAt?: string;
  receivedAt?: string;
  notes?: string;
  lines: PurchaseOrderLine[];
  createdAt: string;
}

const memory = {
  suppliers: [] as Supplier[],
  orders: [] as PurchaseOrder[],
};

const uid = (p: string) => `${p}-${Date.now()}`;
const now = () => new Date().toISOString();

export class PurchasesService {
  private useDb = isDomainOnDb('purchases') && isSupabaseAdminConfigured && Boolean(supabaseAdmin);

  private get admin() {
    if (!supabaseAdmin) throw new Error('Supabase admin client not configured');
    return supabaseAdmin;
  }

  listSuppliers() {
    return memory.suppliers.filter((s) => s.isActive);
  }

  createSupplier(body: Record<string, unknown>) {
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestError('Missing name', 'MISSING_FIELD');
    const supplier: Supplier = {
      id: uid('sup'),
      name,
      contactName: body.contactName ? String(body.contactName) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
      email: body.email ? String(body.email) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
      isActive: true,
    };
    memory.suppliers.unshift(supplier);
    return supplier;
  }

  listOrders() {
    return memory.orders;
  }

  async createOrder(body: Record<string, unknown>) {
    const supplierId = String(body.supplierId || '').trim();
    if (!supplierId) throw new BadRequestError('Missing supplierId', 'MISSING_FIELD');
    const supplier = memory.suppliers.find((s) => s.id === supplierId);
    if (!supplier) throw new NotFoundError('Supplier not found', 'NOT_FOUND');
    const lines: PurchaseOrderLine[] = Array.isArray(body.lines)
      ? body.lines.map((l: Record<string, unknown>) => ({
        id: uid('pol'),
        itemName: String(l.itemName || 'Item'),
        qty: Number(l.qty ?? 1),
        unitCostCents: Math.round(Number(l.unitCostCents ?? 0)),
        inventoryItemId: l.inventoryItemId ? String(l.inventoryItemId) : undefined,
      }))
      : [];
    const totalCents = lines.reduce((sum, l) => sum + l.qty * l.unitCostCents, 0);
    const order: PurchaseOrder = {
      id: uid('po'),
      supplierId,
      supplierName: supplier.name,
      status: 'draft',
      totalCents,
      currency: 'MXN',
      notes: body.notes ? String(body.notes) : undefined,
      lines,
      createdAt: now(),
    };
    memory.orders.unshift(order);
    if (this.useDb) {
      await this.admin.from('purchase_orders').insert({
        id: order.id,
        supplier_id: order.supplierId,
        status: order.status,
        total_cents: order.totalCents,
        currency: order.currency,
        notes: order.notes ?? null,
        created_at: order.createdAt,
        updated_at: order.createdAt,
      });
      for (const line of lines) {
        await this.admin.from('purchase_order_lines').insert({
          id: line.id,
          purchase_order_id: order.id,
          item_name: line.itemName,
          qty: line.qty,
          unit_cost_cents: line.unitCostCents,
          inventory_item_id: line.inventoryItemId ?? null,
        });
      }
    }
    return order;
  }

  receiveOrder(id: string) {
    const order = memory.orders.find((o) => o.id === id);
    if (!order) throw new NotFoundError('Purchase order not found', 'NOT_FOUND');
    order.status = 'received';
    order.receivedAt = now();
    return order;
  }
}

let cached: PurchasesService | null = null;
export const getPurchasesService = () => {
  if (!cached) cached = new PurchasesService();
  return cached;
};
