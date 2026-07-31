import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  new URL(
    '../../supabase/migrations/20260730164500_integration_settings_tenant_id_canonical.sql',
    import.meta.url,
  ),
  'utf8',
);

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

const baseSchema = async (
  db: PGlite,
  options: { withTenantColumn?: boolean } = {},
): Promise<void> => {
  const tenantColumn = options.withTenantColumn
    ? "tenant_id TEXT DEFAULT 'tenant-default',"
    : '';
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS TEXT
      LANGUAGE sql STABLE
      AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;

    CREATE TABLE public.tenants (
      id TEXT PRIMARY KEY
    );

    CREATE TABLE public.wisp_integration_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      ${tenantColumn}
      marker TEXT
    );
  `);
};

const columnState = async (db: PGlite) => {
  const result = await db.query<{ is_nullable: string; column_default: string | null }>(`
    SELECT is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wisp_integration_settings'
      AND column_name = 'tenant_id'
  `);
  return result.rows[0];
};

describe('MT-03 migration ejecutada en Postgres hermético', () => {
  it('parte del esquema limpio sin tenant_id y termina con NOT NULL, unique, FK válida y RLS', async () => {
    const db = await database();
    await baseSchema(db);
    await db.exec(`INSERT INTO public.tenants (id) VALUES ('tenant-default'), ('tenant-a');`);

    await db.exec(migrationSql);
    // La migración puede reintentarse tras un deploy interrumpido y debe
    // comprobar/reutilizar constraints reales, no confiar sólo en sus nombres.
    await db.exec(migrationSql);

    expect(await columnState(db)).toEqual({ is_nullable: 'NO', column_default: null });

    const constraints = await db.query<{
      contype: string;
      convalidated: boolean;
      confdeltype: string;
    }>(`
      SELECT contype, convalidated, confdeltype
      FROM pg_constraint
      WHERE conrelid = 'public.wisp_integration_settings'::regclass
        AND contype = 'f'
    `);
    expect(constraints.rows).toContainEqual({
      contype: 'f',
      convalidated: true,
      confdeltype: 'r',
    });

    const unique = await db.query<{ indisunique: boolean }>(`
      SELECT i.indisunique
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'uq_wisp_integration_settings_tenant_id'
    `);
    expect(unique.rows).toEqual([{ indisunique: true }]);

    const rls = await db.query<{ relrowsecurity: boolean }>(`
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = 'public.wisp_integration_settings'::regclass
    `);
    expect(rls.rows).toEqual([{ relrowsecurity: true }]);

    const policies = await db.query<{ policyname: string }>(`
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'wisp_integration_settings'
    `);
    expect(policies.rows).toContainEqual({
      policyname: 'wisp_integration_settings_service_role',
    });
  });

  it('reconcilia el fixture previo y aplica la regla explícita id=default', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-default'), ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, marker)
      VALUES ('default', 'DEFAULT'), ('tenant-b', 'B');
    `);

    await db.exec(migrationSql);

    const rows = await db.query<{ id: string; tenant_id: string }>(`
      SELECT id, tenant_id
      FROM public.wisp_integration_settings
      ORDER BY id
    `);
    expect(rows.rows).toEqual([
      { id: 'default', tenant_id: 'tenant-default' },
      { id: 'tenant-b', tenant_id: 'tenant-b' },
    ]);
  });

  it('A hace upsert por tenant_id sin modificar la configuración de B', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-b', 'tenant-b', 'B_SECRET');
    `);
    await db.exec(migrationSql);

    await db.exec(`
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-a', 'tenant-a', 'A_VALUE')
      ON CONFLICT (tenant_id) DO UPDATE SET marker = EXCLUDED.marker;
    `);

    const rows = await db.query<{ tenant_id: string; marker: string }>(`
      SELECT tenant_id, marker
      FROM public.wisp_integration_settings
      ORDER BY tenant_id
    `);
    expect(rows.rows).toEqual([
      { tenant_id: 'tenant-a', marker: 'A_VALUE' },
      { tenant_id: 'tenant-b', marker: 'B_SECRET' },
    ]);
  });

  it('RLS niega leer y escribir a un rol de aplicación sin la policy service_role', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-b', 'tenant-b', 'B_SECRET');
    `);
    await db.exec(migrationSql);
    await db.exec(`
      CREATE ROLE mt03_app NOLOGIN;
      GRANT USAGE ON SCHEMA public TO mt03_app;
      GRANT SELECT, INSERT, UPDATE ON public.wisp_integration_settings TO mt03_app;
      SET ROLE mt03_app;
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    const visible = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM public.wisp_integration_settings
    `);
    expect(visible.rows).toEqual([{ count: 0 }]);
    await expect(
      db.exec(`
        INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
        VALUES ('tenant-a', 'tenant-a', 'A_VALUE');
      `),
    ).rejects.toThrow(/row-level security policy/i);
    await db.exec('RESET ROLE;');
  });

  it.each([
    {
      name: 'tenant_id ambiguo',
      tenants: "('tenant-b'), ('tenant-x')",
      rows: "('tenant-b', 'tenant-x', 'ORIGINAL')",
      error: /tenant_id contradice la relación legacy/i,
    },
    {
      name: 'tenant derivado inexistente',
      tenants: "('tenant-a')",
      rows: "('tenant-missing', 'tenant-default', 'ORIGINAL')",
      error: /WISP derivado no existe/i,
    },
    {
      name: 'colisión default y tenant-default',
      tenants: "('tenant-default')",
      rows:
        "('default', 'tenant-default', 'ORIGINAL_DEFAULT'), ('tenant-default', 'tenant-default', 'ORIGINAL_DUP')",
      error: /varias filas reclaman el mismo WISP/i,
    },
  ])('preflight aborta antes de mutar ante $name', async ({ tenants, rows, error }) => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ${tenants};
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker) VALUES ${rows};
    `);

    await expect(db.exec(migrationSql)).rejects.toThrow(error);

    // La fase mutante no comenzó: se conserva tanto el DEFAULT defectuoso
    // como el fixture exacto y no existe el índice canónico.
    expect((await columnState(db)).column_default).toContain('tenant-default');
    const markers = await db.query<{ marker: string }>(`
      SELECT marker FROM public.wisp_integration_settings ORDER BY marker
    `);
    expect(markers.rows.map((row) => row.marker)).toEqual(
      rows.includes('ORIGINAL_DUP')
        ? ['ORIGINAL_DEFAULT', 'ORIGINAL_DUP']
        : ['ORIGINAL'],
    );
    const index = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_class
      WHERE relname = 'uq_wisp_integration_settings_tenant_id'
    `);
    expect(index.rows).toEqual([{ count: 0 }]);
  });
});
