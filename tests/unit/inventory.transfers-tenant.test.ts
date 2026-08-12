import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { NotFoundError } from '../../backend/common/errors';
import { rowToTransfer, type InventoryTransferRow } from '../../backend/domains/inventory/mappers';
import {
  StoreInventoryRepository,
  SupabaseInventoryRepository,
  type InventoryRepository,
} from '../../backend/domains/inventory/repository';
import { InventoryService } from '../../backend/domains/inventory/service';
import type { InventoryTransfer } from '../../backend/domains/inventory/types';
import { DEFAULT_TENANT_ID } from '../../backend/domains/tenancy/types';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const compileOnlyTenantRequired = (repo: InventoryRepository): void => {
  // @ts-expect-error tenantId es obligatorio
  void repo.listTransfers();
  // @ts-expect-error tenantId es obligatorio
  void repo.getTransfer('tr-a');
  // @ts-expect-error tenantId es obligatorio
  void repo.createTransfer({ itemId: 'item-1', qty: 1, toWarehouse: 'Torre Alfa' });
  // @ts-expect-error tenantId es obligatorio
  void repo.completeTransfer('tr-a');
  // @ts-expect-error tenantId es obligatorio
  void repo.cancelTransfer('tr-a');
};
void compileOnlyTenantRequired;

const transferRow = (id: string, tenantId: string, itemId = 'item-1'): InventoryTransferRow => ({
  id,
  tenant_id: tenantId,
  item_id: itemId,
  item_name: `Item ${itemId}`,
  qty: 1,
  from_warehouse: tenantId === TENANT_B ? 'B Origin' : 'Principal',
  to_warehouse: tenantId === TENANT_B ? 'B Dest' : 'Torre Alfa',
  status: 'pending',
  reason: null,
  actor_id: null,
  created_at: '2026-07-30T00:00:00.000Z',
  completed_at: null,
  cancelled_at: null,
});

type FakeRow = Record<string, unknown>;
type FakeResult = { data: unknown; error: null; count?: number };

class FakeQuery implements PromiseLike<FakeResult> {
  private action: 'select' | 'insert' | 'update' = 'select';
  private payload: FakeRow | FakeRow[] | null = null;
  private filters: Array<[string, unknown]> = [];
  private singular = false;

  constructor(
    private readonly table: string,
    private readonly tables: Record<string, FakeRow[]>,
    private readonly writes: Array<{ table: string; action: string; payload: unknown }>,
  ) {}

  select(): this { return this; }
  order(): this { return this; }
  limit(): this { return this; }
  or(): this { return this; }
  gt(column: string, value: unknown): this { return this.eq(column, value); }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  insert(payload: FakeRow | FakeRow[]): this {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: FakeRow): this {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  maybeSingle(): Promise<FakeResult> {
    this.singular = true;
    return Promise.resolve(this.resolve());
  }

  single(): Promise<FakeResult> {
    this.singular = true;
    return Promise.resolve(this.resolve());
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?: ((value: FakeResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private matching(): FakeRow[] {
    return (this.tables[this.table] ?? []).filter((row) =>
      this.filters.every(([column, value]) => row[column] === value));
  }

  private resolve(): FakeResult {
    if (this.action === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      this.tables[this.table] ??= [];
      this.tables[this.table].push(...rows.map((row) => ({ ...row })));
      this.writes.push({ table: this.table, action: 'insert', payload: this.payload });
      return { data: this.singular ? rows[0] : rows, error: null };
    }

    const rows = this.matching();
    if (this.action === 'update') {
      for (const row of rows) Object.assign(row, this.payload);
      this.writes.push({ table: this.table, action: 'update', payload: this.payload });
    }
    return { data: this.singular ? (rows[0] ?? null) : rows, error: null };
  }
}

const fakeSupabase = () => {
  const tables: Record<string, FakeRow[]> = {
    inventory_transfers: [
      transferRow('tr-a', TENANT_A) as unknown as FakeRow,
      transferRow('tr-b', TENANT_B, 'item-b') as unknown as FakeRow,
    ],
    inventory_items: [
      {
        id: 'item-1', tenant_id: TENANT_A, name: 'Item A', category: 'Other', model: 'A', brand: 'Nuga',
        warehouse: 'Principal', qty: 10, serials: [], operational_status: 'Disponible',
        assigned_to_type: null, assigned_to_id: null, assigned_to_label: null,
        created_at: '2026-07-30T00:00:00.000Z', updated_at: '2026-07-30T00:00:00.000Z',
      },
      {
        id: 'item-b', tenant_id: TENANT_B, name: 'Item B', category: 'Other', model: 'B', brand: 'Nuga',
        warehouse: 'B Origin', qty: 10, serials: [], operational_status: 'Disponible',
        assigned_to_type: null, assigned_to_id: null, assigned_to_label: null,
        created_at: '2026-07-30T00:00:00.000Z', updated_at: '2026-07-30T00:00:00.000Z',
      },
    ],
    warehouses: [
      { id: 'wh-a-origin', tenant_id: TENANT_A, name: 'Principal' },
      { id: 'wh-a-dest', tenant_id: TENANT_A, name: 'Torre Alfa' },
      { id: 'wh-b-origin', tenant_id: TENANT_B, name: 'B Origin' },
      { id: 'wh-b-dest', tenant_id: TENANT_B, name: 'B Dest' },
    ],
    inventory_movements: [],
  };
  const writes: Array<{ table: string; action: string; payload: unknown }> = [];
  const client = {
    from: (table: string) => new FakeQuery(table, tables, writes),
  } as unknown as SupabaseClient;
  return { client, tables, writes };
};

describe('MT-05-F2 — contrato de tipos/mapper', () => {
  it('InventoryTransfer y rowToTransfer exponen tenantId canónico', () => {
    const mapped = rowToTransfer(transferRow('tr-map', TENANT_A));

    expect(mapped.tenantId).toBe(TENANT_A);
    expectTypeOf(mapped.tenantId).toEqualTypeOf<string>();
  });

  it('las cinco operaciones repository requieren tenantId en TypeScript', () => {
    expectTypeOf<InventoryRepository['listTransfers']>().parameters.toEqualTypeOf<[string]>();
    expectTypeOf<InventoryRepository['getTransfer']>().parameters.toEqualTypeOf<[string, string]>();
    expectTypeOf<InventoryRepository['createTransfer']>().parameters
      .toEqualTypeOf<[Parameters<InventoryRepository['createTransfer']>[0], string]>();
    expectTypeOf<InventoryRepository['completeTransfer']>().parameters.toEqualTypeOf<[string, string]>();
    expectTypeOf<InventoryRepository['cancelTransfer']>().parameters.toEqualTypeOf<[string, string]>();

  });
});

describe('MT-05-F2 — StoreInventoryRepository fail-closed', () => {
  it('rechaza tenant vacío en repository y service', async () => {
    const repo = new StoreInventoryRepository();
    const service = new InventoryService(repo);

    await expect(repo.listTransfers('')).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
    await expect(service.listTransfers('')).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
  });

  it('stampa tenant canónico e ignora tenant_id/tenantId inyectados en input untyped', async () => {
    const repo = new StoreInventoryRepository();
    const input = {
      itemId: 'item-1', qty: 1, toWarehouse: 'Torre Alfa',
      tenantId: TENANT_B, tenant_id: TENANT_B,
    } as unknown as Parameters<InventoryRepository['createTransfer']>[0];

    const created = await repo.createTransfer(input, DEFAULT_TENANT_ID);

    expect(created.tenantId).toBe(DEFAULT_TENANT_ID);
    const read = await repo.getTransfer(created.id, DEFAULT_TENANT_ID);
    expect(read?.tenantId).toBe(DEFAULT_TENANT_ID);

    // Un caller JS/untyped tampoco debe poder mutar el ownership interno a
    // través del objeto devuelto por get.
    (read as unknown as { tenantId: string }).tenantId = TENANT_B;
    expect((await repo.getTransfer(created.id, DEFAULT_TENANT_ID))?.tenantId)
      .toBe(DEFAULT_TENANT_ID);
    expect(await repo.getTransfer(created.id, TENANT_B)).toBeNull();
  });

  it('A nunca lista/lee/completa/cancela transferencias de B', async () => {
    const repo = new StoreInventoryRepository();
    const internal = repo as unknown as { transfers: InventoryTransfer[] };
    internal.transfers.push(
      rowToTransfer(transferRow('tr-b-complete', TENANT_B, 'item-b')),
      rowToTransfer(transferRow('tr-b-cancel', TENANT_B, 'item-b')),
    );

    expect(await repo.listTransfers(TENANT_A)).toEqual([]);
    expect(await repo.getTransfer('tr-b-complete', TENANT_A)).toBeNull();
    await expect(repo.completeTransfer('tr-b-complete', TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.cancelTransfer('tr-b-cancel', TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    expect(internal.transfers.every((row) => row.status === 'pending')).toBe(true);
  });

  it('no crea para A con relaciones del store legacy/default', async () => {
    const repo = new StoreInventoryRepository();

    await expect(repo.createTransfer(
      { itemId: 'item-1', qty: 1, toWarehouse: 'Torre Alfa' },
      TENANT_A,
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('MT-05-F2 — SupabaseInventoryRepository fail-closed bajo service_role', () => {
  it('A sólo lista/lee filas A y un tenant vacío falla antes de consultar', async () => {
    const fake = fakeSupabase();
    const repo = new SupabaseInventoryRepository(fake.client);

    expect((await repo.listTransfers(TENANT_A)).map((row) => row.id)).toEqual(['tr-a']);
    expect(await repo.getTransfer('tr-b', TENANT_A)).toBeNull();
    await expect(repo.listTransfers('')).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
  });

  it('A no crea con item/warehouses de B ni acepta ownership desde el body', async () => {
    const fake = fakeSupabase();
    const repo = new SupabaseInventoryRepository(fake.client);

    await expect(repo.createTransfer(
      {
        itemId: 'item-b', qty: 1, toWarehouse: 'B Dest',
        tenantId: TENANT_B, tenant_id: TENANT_B,
      } as unknown as Parameters<InventoryRepository['createTransfer']>[0],
      TENANT_A,
    )).rejects.toBeInstanceOf(NotFoundError);
    expect(fake.writes.filter((write) => write.table === 'inventory_transfers')).toEqual([]);
  });

  it('A no completa ni cancela una transferencia B y no escribe nada', async () => {
    const fake = fakeSupabase();
    const repo = new SupabaseInventoryRepository(fake.client);

    await expect(repo.completeTransfer('tr-b', TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    await expect(repo.cancelTransfer('tr-b', TENANT_A)).rejects.toBeInstanceOf(NotFoundError);
    expect(fake.writes).toEqual([]);
  });
});
