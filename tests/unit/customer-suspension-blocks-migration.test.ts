import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsDir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_customer_suspension_blocks.sql'),
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

const baseSchema = async (db: PGlite): Promise<void> => {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$ SELECT current_user::TEXT $$;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE TABLE public.tenants (id TEXT PRIMARY KEY);
    INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b');
    CREATE TABLE public.clients (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES public.tenants(id),
      CONSTRAINT uq_clients_tenant_id_id UNIQUE (tenant_id, id)
    );
    INSERT INTO public.clients (id, tenant_id)
    VALUES ('customer-a', 'tenant-a'), ('customer-b', 'tenant-b');
  `);
};

describe('customer_suspension_blocks migration contract', () => {
  it('is a new versioned additive migration with no backfill heuristic', () => {
    expect(files).toHaveLength(1);
    expect(migrationFile).toBe('20260814050000_customer_suspension_blocks.sql');
    expect(Number(migrationFile.slice(0, 14))).toBeGreaterThan(20260809140000);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.customer_suspension_blocks/i);
    expect(sql).toMatch(/category IN \('financial', 'non_financial', 'unknown'\)/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.customer_suspension_blocks/i);
    expect(sql).not.toMatch(/free.?text|reason\s+ILIKE|customer\.status\s*=\s*'suspended'/i);
    expect(sql).not.toMatch(/supabase db push/i);
  });

  it('defines tenant/customer ownership, active indexes, evidence dedup, RLS, and least privilege', () => {
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id, customer_id\)[\s\S]*REFERENCES public\.clients\(tenant_id, id\)/i);
    expect(sql).toMatch(/CREATE INDEX[\s\S]*idx_customer_suspension_blocks_active_customer[\s\S]*WHERE cleared_at IS NULL/i);
    expect(sql).toMatch(/CREATE INDEX[\s\S]*idx_customer_suspension_blocks_active_category[\s\S]*WHERE cleared_at IS NULL/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*uq_customer_suspension_blocks_evidence[\s\S]*\(tenant_id, evidence_type, evidence_id\)/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/CREATE POLICY customer_suspension_blocks_service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.customer_suspension_blocks FROM PUBLIC, anon, authenticated, service_role/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.customer_suspension_blocks TO service_role/i);
  });

  it('applies idempotently and enforces category, evidence, lifecycle, and tenant/customer constraints', async () => {
    const db = await database();
    await baseSchema(db);
    await db.exec(sql);
    await db.exec(sql);

    await db.exec(`
      INSERT INTO public.customer_suspension_blocks
        (id, tenant_id, customer_id, category, source, reason, evidence_type, evidence_id)
      VALUES
        ('b-fin', 'tenant-a', 'customer-a', 'financial', 'suspension-engine', 'delinquent', 'billing_snapshot', 'snap-1'),
        ('b-non', 'tenant-a', 'customer-a', 'non_financial', 'manual', 'security hold', NULL, NULL),
        ('b-unk', 'tenant-b', 'customer-b', 'unknown', 'legacy', 'ambiguous legacy', NULL, NULL);
    `);

    await expect(db.exec(`
      INSERT INTO public.customer_suspension_blocks
        (id, tenant_id, customer_id, category, source)
      VALUES ('bad-cat', 'tenant-a', 'customer-a', 'none', 'manual');
    `)).rejects.toThrow();

    await expect(db.exec(`
      INSERT INTO public.customer_suspension_blocks
        (id, tenant_id, customer_id, category, source)
      VALUES ('bad-cross', 'tenant-a', 'customer-b', 'financial', 'manual');
    `)).rejects.toThrow();

    await expect(db.exec(`
      INSERT INTO public.customer_suspension_blocks
        (id, tenant_id, customer_id, category, source, evidence_type, evidence_id)
      VALUES ('bad-dupe', 'tenant-a', 'customer-a', 'financial', 'suspension-engine', 'billing_snapshot', 'snap-1');
    `)).rejects.toThrow();

    await db.exec(`
      UPDATE public.customer_suspension_blocks
      SET cleared_at = now(), cleared_by = 'operator-1', clear_reason = 'paid', updated_at = now()
      WHERE id = 'b-fin' AND tenant_id = 'tenant-a';
    `);

    expect((await db.query(`
      SELECT category FROM public.customer_suspension_blocks
      WHERE tenant_id = 'tenant-a' AND customer_id = 'customer-a' AND cleared_at IS NULL
      ORDER BY category
    `)).rows).toEqual([{ category: 'non_financial' }]);
  });
});
