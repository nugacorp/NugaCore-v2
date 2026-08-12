import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findPgBinDir, startHermeticPg, type HermeticPg } from '../helpers/hermetic-pg';
import { applySchema, listMigrations } from '../helpers/nugacore-schema';

const OPT_IN = process.env.RUN_PG_LOCAL_TESTS === 'true';
const PG_BIN = findPgBinDir();
const MIGRATION_SUFFIX = '_tenantize_inventory_transfers.sql';
const ROLLBACK_SUFFIX = '_tenantize_inventory_transfers.down.sql';
const MISSING_MIGRATION = '99999999999999_tenantize_inventory_transfers.sql';
const BOOT_TIMEOUT_MS = 600_000;
const CASE_TIMEOUT_MS = 180_000;
const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

const migrationName = (): string =>
  listMigrations().find((file) => file.endsWith(MIGRATION_SUFFIX)) ?? MISSING_MIGRATION;

const migrationPath = (): string => resolve('supabase/migrations', migrationName());

const rollbackPath = (): string => {
  const name = migrationName().replace(/\.sql$/, '.down.sql');
  return resolve('supabase/rollbacks', name);
};

const tenantFixtures = `
  INSERT INTO public.tenants (id, name, slug) VALUES
    ('tenant-a', 'WISP A', 'wisp-a'),
    ('tenant-b', 'WISP B', 'wisp-b')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.warehouses (id, name, type, tenant_id) VALUES
    ('wh-a-origin', 'A Origin', 'principal', 'tenant-a'),
    ('wh-a-dest', 'A Dest', 'torre', 'tenant-a'),
    ('wh-b-origin', 'B Origin', 'principal', 'tenant-b'),
    ('wh-b-dest', 'B Dest', 'torre', 'tenant-b');

  INSERT INTO public.inventory_items
    (id, name, category, model, brand, warehouse, qty, tenant_id)
  VALUES
    ('item-a', 'Item A', 'Other', 'A-1', 'Nuga', 'A Origin', 10, 'tenant-a'),
    ('item-b', 'Item B', 'Other', 'B-1', 'Nuga', 'B Origin', 10, 'tenant-b');
`;

const legacyTransfer = (
  id: string,
  itemId: string,
  fromWarehouse: string,
  toWarehouse: string,
): string => `
  INSERT INTO public.inventory_transfers
    (id, item_id, item_name, qty, from_warehouse, to_warehouse, status)
  VALUES ('${id}', '${itemId}', '${itemId}', 1, '${fromWarehouse}', '${toWarehouse}', 'pending');
`;

const scopedTransfer = (
  id: string,
  tenantId: string,
  itemId: string,
  fromWarehouse: string,
  toWarehouse: string,
): string => `
  INSERT INTO public.inventory_transfers
    (id, tenant_id, item_id, item_name, qty, from_warehouse, to_warehouse, status)
  VALUES ('${id}', '${tenantId}', '${itemId}', '${itemId}', 1,
          '${fromWarehouse}', '${toWarehouse}', 'pending');
`;

if (OPT_IN && !PG_BIN) {
  describe('MT-05-F2 configuración PostgreSQL', () => {
    it('requiere binarios PostgreSQL locales', () => {
      throw new Error('RUN_PG_LOCAL_TESTS=true pero no se encontraron initdb/pg_ctl/psql');
    });
  });
}

describe.skipIf(!OPT_IN || !PG_BIN)(
  'MT-05-F2 — inventory_transfers tenant-scoped (PostgreSQL hermético)',
  () => {
    let pg: HermeticPg;
    let cleanApplied: string[];

    const fork = (template: string, name: string): string => {
      pg.exec(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
      return name;
    };

    const hasColumn = (db: string, table: string, column: string): boolean =>
      pg.scalar(
        `SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema='public' AND table_name='${table}' AND column_name='${column}'`,
        db,
      ) === '1';

    const constraintDef = (db: string, name: string): string =>
      pg.scalar(
        `SELECT COALESCE(
           (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='${name}'),
           '<ausente>')`,
        db,
      );

    const indexDef = (db: string, name: string): string =>
      pg.scalar(
        `SELECT COALESCE(
           (SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='${name}'),
           '<ausente>')`,
        db,
      );

    beforeAll(async () => {
      pg = await startHermeticPg();

      pg.exec('CREATE DATABASE f2_prior');
      applySchema(pg, 'f2_prior', { mode: 'full', before: migrationName() });

      pg.exec('CREATE DATABASE f2_clean');
      cleanApplied = applySchema(pg, 'f2_clean', { mode: 'full' });
    }, BOOT_TIMEOUT_MS);

    afterAll(() => pg?.stop());

    it('clean aplica todos los archivos reales y deja ownership/constraints/índices exactos', () => {
      expect(cleanApplied).toEqual(listMigrations());
      expect(hasColumn('f2_clean', 'inventory_transfers', 'tenant_id')).toBe(true);
      expect(
        pg.scalar(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema='public' AND table_name='inventory_transfers' AND column_name='tenant_id'`,
          'f2_clean',
        ),
      ).toBe('NO');
      expect(constraintDef('f2_clean', 'inventory_transfers_tenant_id_fkey')).toBe(
        'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
      );
      expect(constraintDef('f2_clean', 'uq_inventory_items_tenant_id_id')).toBe(
        'UNIQUE (tenant_id, id)',
      );
      expect(constraintDef('f2_clean', 'uq_warehouses_tenant_id_name')).toBe(
        'UNIQUE (tenant_id, name)',
      );
      expect(constraintDef('f2_clean', 'inventory_items_tenant_warehouse_fkey')).toBe(
        'FOREIGN KEY (tenant_id, warehouse) REFERENCES warehouses(tenant_id, name) ON DELETE RESTRICT',
      );
      expect(constraintDef('f2_clean', 'inventory_transfers_tenant_item_fkey')).toBe(
        'FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id) ON DELETE CASCADE',
      );
      expect(constraintDef('f2_clean', 'inventory_transfers_tenant_from_warehouse_fkey')).toBe(
        'FOREIGN KEY (tenant_id, from_warehouse) REFERENCES warehouses(tenant_id, name) ON DELETE RESTRICT',
      );
      expect(constraintDef('f2_clean', 'inventory_transfers_tenant_to_warehouse_fkey')).toBe(
        'FOREIGN KEY (tenant_id, to_warehouse) REFERENCES warehouses(tenant_id, name) ON DELETE RESTRICT',
      );
      expect(indexDef('f2_clean', 'idx_inventory_items_tenant_warehouse')).toMatch(
        /\(tenant_id, warehouse\)$/,
      );
      expect(indexDef('f2_clean', 'idx_inventory_transfers_tenant_item')).toMatch(
        /\(tenant_id, item_id\)$/,
      );
      expect(indexDef('f2_clean', 'idx_inventory_transfers_tenant_from_warehouse')).toMatch(
        /\(tenant_id, from_warehouse\)$/,
      );
      expect(indexDef('f2_clean', 'idx_inventory_transfers_tenant_to_warehouse')).toMatch(
        /\(tenant_id, to_warehouse\)$/,
      );
    });

    it('upgrade válido deriva tenant-a sólo cuando item y ambos warehouses concuerdan', () => {
      const db = fork('f2_prior', 'f2_upgrade_valid');
      pg.exec(tenantFixtures, db);
      pg.exec(legacyTransfer('tr-legacy-a', 'item-a', 'A Origin', 'A Dest'), db);

      const migrated = pg.runFile(migrationPath(), db);

      expect(migrated.code, migrated.stderr).toBe(0);
      expect(pg.scalar(`SELECT tenant_id FROM public.inventory_transfers WHERE id='tr-legacy-a'`, db))
        .toBe('tenant-a');
      expect(pg.runFile(migrationPath(), db).code).toBe(0);
    });

    it('preflight rechaza warehouse destino huérfano antes de crear tenant_id', () => {
      const db = fork('f2_prior', 'f2_orphan_destination');
      pg.exec(tenantFixtures, db);
      pg.exec(legacyTransfer('tr-orphan', 'item-a', 'A Origin', 'Missing Warehouse'), db);

      const migrated = pg.runFile(migrationPath(), db);

      expect(migrated.code).not.toBe(0);
      expect(migrated.stderr).toMatch(/destinos huerfanos=1/);
      expect(hasColumn(db, 'inventory_transfers', 'tenant_id')).toBe(false);
      expect(constraintDef(db, 'uq_warehouses_tenant_id_name')).toBe('<ausente>');
      expect(pg.scalar(`SELECT to_warehouse FROM public.inventory_transfers WHERE id='tr-orphan'`, db))
        .toBe('Missing Warehouse');
    });

    it('preflight rechaza A→B antes de mutar schema o datos', () => {
      const db = fork('f2_prior', 'f2_crossed_legacy');
      pg.exec(tenantFixtures, db);
      pg.exec(legacyTransfer('tr-cross', 'item-a', 'A Origin', 'B Dest'), db);

      const migrated = pg.runFile(migrationPath(), db);

      expect(migrated.code).not.toBe(0);
      expect(migrated.stderr).toMatch(/tenants discordantes=1/);
      expect(hasColumn(db, 'inventory_transfers', 'tenant_id')).toBe(false);
      expect(pg.scalar(`SELECT item_id FROM public.inventory_transfers WHERE id='tr-cross'`, db))
        .toBe('item-a');
    });

    it('service_role acepta A→A y rechaza item/origen/destino A→B', () => {
      const db = fork('f2_prior', 'f2_service_role');
      pg.exec(tenantFixtures, db);
      expect(pg.runFile(migrationPath(), db).code).toBe(0);
      pg.exec(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants, public.inventory_items,
           public.inventory_transfers, public.warehouses TO service_role`,
        db,
      );

      const valid = pg.run(
        `SET ROLE service_role; ${scopedTransfer('tr-service-aa', 'tenant-a', 'item-a', 'A Origin', 'A Dest')}`,
        db,
      );
      expect(valid.code, valid.stderr).toBe(0);

      const crossedItem = pg.run(
        `SET ROLE service_role; ${scopedTransfer('tr-item-ab', 'tenant-a', 'item-b', 'A Origin', 'A Dest')}`,
        db,
      );
      expect(crossedItem.code).not.toBe(0);
      expect(crossedItem.stderr).toMatch(/inventory_transfers_tenant_item_fkey/);

      const crossedOrigin = pg.run(
        `SET ROLE service_role; ${scopedTransfer('tr-origin-ab', 'tenant-a', 'item-a', 'B Origin', 'A Dest')}`,
        db,
      );
      expect(crossedOrigin.code).not.toBe(0);
      expect(crossedOrigin.stderr).toMatch(/inventory_transfers_tenant_from_warehouse_fkey/);

      const crossedDestination = pg.run(
        `SET ROLE service_role; ${scopedTransfer('tr-dest-ab', 'tenant-a', 'item-a', 'A Origin', 'B Dest')}`,
        db,
      );
      expect(crossedDestination.code).not.toBe(0);
      expect(crossedDestination.stderr).toMatch(/inventory_transfers_tenant_to_warehouse_fkey/);
    });

    it(
      'lock_timeout aborta acotadamente sin columna ni backfill parcial',
      async () => {
        const db = fork('f2_prior', 'f2_lock_timeout');
        pg.exec(tenantFixtures, db);
        pg.exec(legacyTransfer('tr-lock', 'item-a', 'A Origin', 'A Dest'), db);
        const blocker = pg.startSession(
          `BEGIN;
           LOCK TABLE public.inventory_items IN ACCESS EXCLUSIVE MODE;
           SELECT pg_sleep(8);
           ROLLBACK;`,
          db,
        );

        try {
          let held = false;
          for (let attempt = 0; attempt < 100; attempt += 1) {
            held = pg.scalar(
              `SELECT count(*)::text
               FROM pg_locks l
               JOIN pg_class c ON c.oid=l.relation
               JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
                 AND n.nspname='public' AND c.relname='inventory_items'
                 AND l.mode='AccessExclusiveLock' AND l.granted`,
              db,
            ) === '1';
            if (held) break;
            await delay(50);
          }
          expect(held).toBe(true);

          const started = Date.now();
          const migrated = pg.runFile(migrationPath(), db);
          const elapsed = Date.now() - started;

          expect(migrated.code).not.toBe(0);
          expect(migrated.stderr).toMatch(/lock timeout/i);
          expect(elapsed).toBeGreaterThanOrEqual(1_500);
          expect(elapsed).toBeLessThan(5_000);
          expect(hasColumn(db, 'inventory_transfers', 'tenant_id')).toBe(false);
          expect(pg.scalar(`SELECT item_id FROM public.inventory_transfers WHERE id='tr-lock'`, db))
            .toBe('item-a');
        } finally {
          blocker.stop();
          await Promise.race([blocker.exited, delay(5_000)]);
        }
      },
      CASE_TIMEOUT_MS,
    );

    it('rollback conserva tenant_id/datos y restaura la FK simple del item', () => {
      const db = fork('f2_prior', 'f2_rollback');
      pg.exec(tenantFixtures, db);
      pg.exec(legacyTransfer('tr-rollback', 'item-a', 'A Origin', 'A Dest'), db);
      expect(pg.runFile(migrationPath(), db).code).toBe(0);

      const rolledBack = pg.runFile(rollbackPath(), db);

      expect(rolledBack.code, rolledBack.stderr).toBe(0);
      expect(hasColumn(db, 'inventory_transfers', 'tenant_id')).toBe(true);
      expect(pg.scalar(`SELECT tenant_id FROM public.inventory_transfers WHERE id='tr-rollback'`, db))
        .toBe('tenant-a');
      expect(constraintDef(db, 'inventory_transfers_tenant_item_fkey')).toBe('<ausente>');
      expect(constraintDef(db, 'inventory_transfers_item_id_fkey')).toBe(
        'FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE',
      );
      expect(ROLLBACK_SUFFIX).toBe('_tenantize_inventory_transfers.down.sql');
    });
  },
);
