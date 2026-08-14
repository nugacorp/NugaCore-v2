import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import {
  StoreSuspensionRepository,
  SupabaseSuspensionRepository,
} from '../../backend/domains/suspension/repository';

type Row = Record<string, unknown>;

const row = (id: string, overrides: Row = {}): Row => ({
  id,
  tenant_id: 'tenant-a',
  customer_id: 'customer-a',
  category: 'financial',
  source: 'suspension-engine',
  reason: null,
  evidence_type: null,
  evidence_id: null,
  created_at: '2026-08-14T00:00:00.000Z',
  cleared_at: null,
  cleared_by: null,
  clear_reason: null,
  updated_at: '2026-08-14T00:00:00.000Z',
  ...overrides,
});

const fakeSupabase = (initialRows: Row[] = []) => {
  const rows = [...initialRows];
  const apply = (filters: Array<(candidate: Row) => boolean>) => rows.filter((candidate) => filters.every((fn) => fn(candidate)));
  const client = {
    from: (table: string) => {
      if (table !== 'customer_suspension_blocks') {
        throw new Error(`unexpected table ${table}`);
      }
      const filters: Array<(candidate: Row) => boolean> = [];
      let patch: Row | null = null;
      const builder = {
        select: () => builder,
        order: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push((candidate) => candidate[column] === value);
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push((candidate) => candidate[column] === value);
          return builder;
        },
        insert: async (value: Row) => {
          rows.push(value);
          return { error: null };
        },
        update: (value: Row) => {
          patch = value;
          return builder;
        },
        maybeSingle: async () => {
          const found = apply(filters)[0] ?? null;
          if (found && patch) Object.assign(found, patch);
          return { data: found, error: null };
        },
        then: (resolve: (value: { data: Row[]; error: null }) => void) => {
          resolve({ data: apply(filters), error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, rows };
};

describe('StoreSuspensionRepository suspension blocks', () => {
  it('creates, lists, filters active blocks, and clears without touching unrelated blockers', async () => {
    engineStore.reset();
    const repo = new StoreSuspensionRepository();

    const financial = await repo.createSuspensionBlock({
      id: 'block-fin',
      tenantId: 'tenant-a',
      customerId: 'customer-a',
      category: 'financial',
      source: 'suspension-engine',
      evidenceType: 'billing_snapshot',
      evidenceId: 'snap-1',
    });
    await repo.createSuspensionBlock({
      id: 'block-manual',
      tenantId: 'tenant-a',
      customerId: 'customer-a',
      category: 'non_financial',
      source: 'manual',
    });
    await repo.createSuspensionBlock({
      id: 'block-other-tenant',
      tenantId: 'tenant-b',
      customerId: 'customer-b',
      category: 'unknown',
      source: 'legacy',
    });

    expect(await repo.listSuspensionBlocks({ tenantId: 'tenant-a', customerId: 'customer-a', activeOnly: true }))
      .toHaveLength(2);

    await repo.clearSuspensionBlock({
      tenantId: 'tenant-a',
      blockId: financial.id,
      clearedAt: '2026-08-14T01:00:00.000Z',
      clearedBy: 'operator-1',
      clearReason: 'paid',
    });

    expect(await repo.listSuspensionBlocks({ tenantId: 'tenant-a', customerId: 'customer-a', activeOnly: true }))
      .toMatchObject([{ category: 'non_financial' }]);
    expect(await repo.listSuspensionBlocks({ tenantId: 'tenant-b', activeOnly: true }))
      .toMatchObject([{ category: 'unknown' }]);
  });

  it('deduplicates evidence replay inside tenant scope', async () => {
    engineStore.reset();
    const repo = new StoreSuspensionRepository();
    const first = await repo.createSuspensionBlock({
      tenantId: 'tenant-a',
      customerId: 'customer-a',
      category: 'financial',
      source: 'suspension-engine',
      evidenceType: 'billing_snapshot',
      evidenceId: 'snap-1',
    });
    const replay = await repo.createSuspensionBlock({
      tenantId: 'tenant-a',
      customerId: 'customer-a',
      category: 'financial',
      source: 'suspension-engine',
      evidenceType: 'billing_snapshot',
      evidenceId: 'snap-1',
    });

    expect(replay.id).toBe(first.id);
    expect(await repo.listSuspensionBlocks({ tenantId: 'tenant-a' })).toHaveLength(1);
  });
});

describe('SupabaseSuspensionRepository suspension block queries', () => {
  it('always filters list and clear operations by tenant', async () => {
    const { client, rows } = fakeSupabase([
      row('block-a'),
      row('block-b', { tenant_id: 'tenant-b', customer_id: 'customer-b' }),
    ]);
    const repo = new SupabaseSuspensionRepository(client);

    expect(await repo.listSuspensionBlocks({ tenantId: 'tenant-a', activeOnly: true }))
      .toMatchObject([{ id: 'block-a', tenantId: 'tenant-a' }]);

    await repo.clearSuspensionBlock({
      tenantId: 'tenant-a',
      blockId: 'block-a',
      clearedAt: '2026-08-14T01:00:00.000Z',
      clearReason: 'paid',
    });

    expect(rows.find((candidate) => candidate.id === 'block-a')?.cleared_at).toBe('2026-08-14T01:00:00.000Z');
    expect(rows.find((candidate) => candidate.id === 'block-b')?.cleared_at).toBeNull();
  });
});
