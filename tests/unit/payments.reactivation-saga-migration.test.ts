import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsDir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_reactivation_order_saga.sql'),
);
const migrationFile = files[0] ?? '';
const sql = migrationFile ? readFileSync(new URL(migrationFile, migrationsDir), 'utf8') : '';
const databases: PGlite[] = [];

const database = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.waitReady;
  databases.push(db);
  return db;
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

const baseSchema = async (db: PGlite, upgraded = false): Promise<void> => {
  await db.exec(`
    CREATE TABLE public.tenants (id TEXT PRIMARY KEY);
    INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b')${upgraded ? ", ('tenant-default')" : ''};
    CREATE TABLE public.clients (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES public.tenants(id)
    );
    INSERT INTO public.clients (id, tenant_id)
    VALUES ('customer-a', 'tenant-a'), ('customer-b', 'tenant-b');
    CREATE TABLE public.reactivation_orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES public.clients(id),
      status TEXT NOT NULL DEFAULT 'PENDING',
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ${upgraded ? "tenant_id TEXT DEFAULT 'tenant-default', router_id TEXT, idempotency_key TEXT," : ''}
      CONSTRAINT reactivation_orders_source_check
        CHECK (source IN (${upgraded
          ? "'engine','manual','payment-engine','provisioning-center','service-status'"
          : "'engine','manual'"}))
    );
    ${upgraded ? `
      CREATE UNIQUE INDEX uq_reactivation_orders_tenant_idempotency
        ON public.reactivation_orders (tenant_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    ` : ''}
  `);
};

const snapshot = async (db: PGlite) => ({
  columns: (await db.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reactivation_orders'
    ORDER BY ordinal_position
  `)).rows,
  constraints: (await db.query(`
    SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.reactivation_orders'::regclass
    ORDER BY conname
  `)).rows,
  indexes: (await db.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'reactivation_orders'
    ORDER BY indexname
  `)).rows,
  rows: (await db.query(`SELECT row_to_json(r)::text AS row FROM public.reactivation_orders r ORDER BY id`)).rows,
});

describe('MT-04-F3 migration — contrato estático', () => {
  it('usa una migración aditiva nueva y no reescribe la base histórica', () => {
    expect(files).toHaveLength(1);
    expect(Number(migrationFile.slice(0, 14))).toBeGreaterThan(20260807170000);
    expect(sql).not.toMatch(/CREATE TABLE/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tenant_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS router_id TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS idempotency_key TEXT/i);
  });

  it('hace preflight bajo lock/timeout antes de la primera mutación y termina con postcondición', () => {
    expect(sql).toMatch(/BEGIN;[\s\S]*?SET LOCAL lock_timeout[\s\S]*?SET LOCAL statement_timeout/i);
    const preflight = sql.search(/preflight completo aprobado/i);
    const firstMutation = sql.search(/ALTER TABLE public\.reactivation_orders\s+ADD COLUMN/i);
    expect(preflight).toBeGreaterThan(0);
    expect(firstMutation).toBeGreaterThan(preflight);
    expect(sql).toMatch(/LOCK TABLE public\.reactivation_orders IN ACCESS EXCLUSIVE MODE/i);
    expect(sql).toMatch(/postcondición fallida/i);
    expect(sql.trimEnd()).toMatch(/COMMIT;$/i);
  });

  it('impone ownership payment-engine, FK tenant e índices exactos', () => {
    expect(sql).toMatch(/CHECK[\s\S]*?source[\s\S]*?payment-engine[\s\S]*?tenant_id[\s\S]*?router_id[\s\S]*?idempotency_key/i);
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id\) REFERENCES public\.tenants\(id\) ON DELETE RESTRICT/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*?\(tenant_id, idempotency_key\)[\s\S]*?WHERE idempotency_key IS NOT NULL/i);
    expect(sql).toMatch(/CREATE INDEX[\s\S]*?\(tenant_id, status\)/i);
    expect(sql).toMatch(/FK compuesta customer\/tenant diferida a MT-05/i);
  });
});

describe('MT-04-F3 migration — Postgres hermético', () => {
  it.each([false, true])('migra clean/upgrade, conserva legacy y es reejecutable (upgrade=%s)', async (upgraded) => {
    const db = await database();
    await baseSchema(db, upgraded);
    await db.exec(`
      INSERT INTO public.reactivation_orders (id, customer_id, source)
      VALUES ('legacy-1', 'customer-a', 'engine');
    `);

    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      INSERT INTO public.reactivation_orders
        (id, customer_id, tenant_id, router_id, idempotency_key, source)
      VALUES
        ('payment-1', 'customer-a', 'tenant-a', 'router-a', 'payment-key-1', 'payment-engine');
    `);

    expect((await db.query(`
      SELECT id, tenant_id, router_id, idempotency_key, source
      FROM public.reactivation_orders ORDER BY id
    `)).rows).toEqual([
      { id: 'legacy-1', tenant_id: upgraded ? 'tenant-default' : null, router_id: null, idempotency_key: null, source: 'engine' },
      { id: 'payment-1', tenant_id: 'tenant-a', router_id: 'router-a', idempotency_key: 'payment-key-1', source: 'payment-engine' },
    ]);
    await expect(db.exec(`
      INSERT INTO public.reactivation_orders
        (id, customer_id, tenant_id, router_id, idempotency_key, source)
      VALUES ('payment-2', 'customer-a', 'tenant-a', 'router-a', 'payment-key-1', 'payment-engine');
    `)).rejects.toMatchObject({ code: '23505' });
  });

  it('aborta antes de mutar ante un índice homónimo incompatible', async () => {
    const db = await database();
    await baseSchema(db);
    await db.exec(`
      CREATE UNIQUE INDEX uq_reactivation_orders_tenant_idempotency
        ON public.reactivation_orders (customer_id);
      INSERT INTO public.reactivation_orders (id, customer_id, source)
      VALUES ('legacy-1', 'customer-a', 'engine');
    `);
    const before = await snapshot(db);

    await expect(db.exec(sql)).rejects.toThrow(/uq_reactivation_orders_tenant_idempotency.*incompatible/i);
    await db.exec('ROLLBACK;');
    expect(await snapshot(db)).toEqual(before);
  });
});
