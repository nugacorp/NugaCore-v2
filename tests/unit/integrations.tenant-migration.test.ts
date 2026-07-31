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
  options: {
    withTenantColumn?: boolean;
    serviceRole?: 'bypassrls' | 'no-bypassrls' | 'missing';
  } = {},
): Promise<void> => {
  const tenantColumn = options.withTenantColumn
    ? "tenant_id TEXT DEFAULT 'tenant-default',"
    : '';
  const serviceRole = options.serviceRole === 'missing'
    ? ''
    : `CREATE ROLE service_role NOLOGIN ${
      options.serviceRole === 'no-bypassrls' ? 'NOBYPASSRLS' : 'BYPASSRLS'
    };`;
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE authenticated NOLOGIN;
    ${serviceRole}
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

/** Divide SQL respetando strings, comentarios y bloques dollar-quoted de DO. */
const sqlStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let dollarTag = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1] ?? '';
    current += char;

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        current += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag.slice(1);
        i += dollarTag.length - 1;
        dollarTag = '';
      }
      continue;
    }
    if (inSingle) {
      if (char === "'" && next === "'") {
        current += next;
        i += 1;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (char === '"' && next === '"') {
        current += next;
        i += 1;
      } else if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      current += next;
      i += 1;
      inLineComment = true;
      continue;
    }
    if (char === '/' && next === '*') {
      current += next;
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (char === "'") {
      inSingle = true;
      continue;
    }
    if (char === '"') {
      inDouble = true;
      continue;
    }
    if (char === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag.slice(1);
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
};

const executeByStatements = async (
  db: PGlite,
  notices: string[] = [],
): Promise<void> => {
  for (const statement of sqlStatements(migrationSql)) {
    await db.exec(statement, {
      onNotice: (notice) => notices.push(notice.message ?? ''),
    });
  }
};

const catalogSnapshot = async (db: PGlite) => {
  const [columns, rows, indexes, constraints, policies, rls] = await Promise.all([
    db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'wisp_integration_settings'
      ORDER BY ordinal_position
    `),
    db.query(`
      SELECT row_to_json(s)::text AS row
      FROM public.wisp_integration_settings s
      ORDER BY id
    `),
    db.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'wisp_integration_settings'
      ORDER BY indexname
    `),
    db.query(`
      SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.wisp_integration_settings'::regclass
      ORDER BY conname
    `),
    db.query(`
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'wisp_integration_settings'
      ORDER BY policyname
    `),
    db.query(`
      SELECT relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE oid = 'public.wisp_integration_settings'::regclass
    `),
  ]);
  return {
    columns: columns.rows,
    rows: rows.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    policies: policies.rows,
    rls: rls.rows,
  };
};

const expectPreflightFailureWithoutMutation = async (
  db: PGlite,
  error: RegExp,
): Promise<string[]> => {
  const before = await catalogSnapshot(db);
  const notices: string[] = [];
  await expect(executeByStatements(db, notices)).rejects.toThrow(error);
  // El error deja la transacción abortada; ROLLBACK ocurre en la misma conexión.
  await db.exec('ROLLBACK;');
  expect(await catalogSnapshot(db)).toEqual(before);
  expect(notices.some((notice) => /fase mutante|fila\(s\) corregidas/i.test(notice))).toBe(false);
  return notices;
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

    const policies = await db.query<{
      policyname: string;
      permissive: string;
      roles: string[];
      cmd: string;
      qual: string;
      with_check: string;
    }>(`
      SELECT policyname, permissive, roles, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'wisp_integration_settings'
    `);
    expect(policies.rows).toEqual([{
      policyname: 'wisp_integration_settings_service_role',
      permissive: 'PERMISSIVE',
      roles: ['service_role'],
      cmd: 'ALL',
      qual: 'true',
      with_check: 'true',
    }]);

    const policyRole = await db.query<{
      policy_roles: number[];
      service_role_oid: number;
      rolbypassrls: boolean;
    }>(`
      SELECT
        p.polroles::oid[] AS policy_roles,
        r.oid AS service_role_oid,
        r.rolbypassrls
      FROM pg_policy p
      JOIN pg_roles r ON r.rolname = 'service_role'
      WHERE p.polrelid = 'public.wisp_integration_settings'::regclass
        AND p.polname = 'wisp_integration_settings_service_role'
    `);
    expect(policyRole.rows).toEqual([expect.objectContaining({ rolbypassrls: true })]);
    expect(policyRole.rows[0]?.policy_roles).toEqual([
      policyRole.rows[0]?.service_role_oid,
    ]);
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

  it('Postgres aborta por PK id si ON CONFLICT(tenant_id) no elige esa fila', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b');`);
    await db.exec(migrationSql);
    await db.exec(`
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-a', 'tenant-b', 'B_SECRET');
    `);

    await expect(db.exec(`
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-a', 'tenant-a', 'A_VALUE')
      ON CONFLICT (tenant_id) DO UPDATE SET marker = EXCLUDED.marker;
    `)).rejects.toMatchObject({ code: '23505' });
    expect((await db.query(`
      SELECT id, tenant_id, marker FROM public.wisp_integration_settings
    `)).rows).toEqual([{ id: 'tenant-a', tenant_id: 'tenant-b', marker: 'B_SECRET' }]);
  });

  it('liga acceso al rol real: authenticated no falsifica service_role y BYPASSRLS ignora claims', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-a'), ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-b', 'tenant-b', 'B_SECRET');
    `);
    await db.exec(migrationSql);
    await db.exec(`
      GRANT USAGE ON SCHEMA public TO authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE ON public.wisp_integration_settings TO authenticated, service_role;
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.role', 'service_role', false);
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
    const updated = await db.query(`
      UPDATE public.wisp_integration_settings
      SET marker = 'SPOOFED_UPDATE'
      WHERE tenant_id = 'tenant-b'
      RETURNING tenant_id
    `);
    expect(updated.rows).toEqual([]);
    await expect(
      db.exec(`
        INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
        VALUES ('tenant-b', 'tenant-b', 'SPOOFED_UPSERT')
        ON CONFLICT (tenant_id) DO UPDATE SET marker = EXCLUDED.marker;
      `),
    ).rejects.toThrow(/row-level security policy/i);
    await db.exec('RESET ROLE;');

    await db.exec(`
      SET ROLE service_role;
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
    expect(
      (await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM public.wisp_integration_settings
      `)).rows,
    ).toEqual([{ count: 1 }]);
    await db.exec(`
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-a', 'tenant-a', 'SERVICE_WRITE');
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-a', 'tenant-a', 'SERVICE_UPSERT')
      ON CONFLICT (tenant_id) DO UPDATE SET marker = EXCLUDED.marker;
      RESET ROLE;
    `);
    expect((await db.query<{ marker: string }>(`
      SELECT marker FROM public.wisp_integration_settings WHERE tenant_id = 'tenant-a'
    `)).rows).toEqual([{ marker: 'SERVICE_UPSERT' }]);
  });

  it.each(['missing', 'no-bypassrls'] as const)(
    'preflight rechaza service_role %s antes de mutar',
    async (serviceRole) => {
      const db = await database();
      await baseSchema(db, { serviceRole });
      await db.exec(`
        INSERT INTO public.tenants (id) VALUES ('tenant-default');
        INSERT INTO public.wisp_integration_settings (id, marker)
        VALUES ('default', 'ORIGINAL');
      `);

      await expectPreflightFailureWithoutMutation(
        db,
        /service_role.*(no existe|BYPASSRLS)/i,
      );
    },
  );

  it.each([false, true])(
    'preflight rechaza índice homónimo incorrecto antes de mutar (tenant_id=%s)',
    async (withTenantColumn) => {
      const db = await database();
      await baseSchema(db, { withTenantColumn });
      await db.exec(`
        INSERT INTO public.tenants (id) VALUES ('tenant-b');
        INSERT INTO public.wisp_integration_settings (id, marker) VALUES ('tenant-b', 'ORIGINAL');
        CREATE UNIQUE INDEX uq_wisp_integration_settings_tenant_id
          ON public.wisp_integration_settings (marker);
      `);

      await expectPreflightFailureWithoutMutation(db, /no es UNIQUE\(tenant_id\)/i);
    },
  );

  it.each([false, true])(
    'preflight rechaza una constraint FK homónima incorrecta antes de mutar (tenant_id=%s)',
    async (withTenantColumn) => {
    const db = await database();
    await baseSchema(db, { withTenantColumn });
    await db.exec(withTenantColumn
      ? `
          CREATE TABLE public.other_tenants (id TEXT PRIMARY KEY);
          INSERT INTO public.tenants (id) VALUES ('tenant-b');
          INSERT INTO public.other_tenants (id) VALUES ('tenant-b');
          INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
          VALUES ('tenant-b', 'tenant-b', 'ORIGINAL');
          ALTER TABLE public.wisp_integration_settings
            ADD CONSTRAINT wisp_integration_settings_tenant_id_fkey
            FOREIGN KEY (tenant_id) REFERENCES public.other_tenants(id);
        `
      : `
          INSERT INTO public.tenants (id) VALUES ('tenant-b');
          INSERT INTO public.wisp_integration_settings (id, marker)
          VALUES ('tenant-b', 'ORIGINAL');
          ALTER TABLE public.wisp_integration_settings
            ADD CONSTRAINT wisp_integration_settings_tenant_id_fkey
            CHECK (marker IS NOT NULL);
        `);

    await expectPreflightFailureWithoutMutation(db, /FK.*tenant_id.*incompatible/i);
    },
  );

  it.each([false, true])(
    'preflight rechaza policy legacy PUBLIC/auth.role() antes de mutar (tenant_id=%s)',
    async (withTenantColumn) => {
    const db = await database();
    await baseSchema(db, { withTenantColumn });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, marker)
      VALUES ('tenant-b', 'ORIGINAL');
      ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;
      CREATE POLICY wisp_integration_settings_service_role
        ON public.wisp_integration_settings FOR ALL
        TO public
        USING ((select auth.role()) = 'service_role')
        WITH CHECK ((select auth.role()) = 'service_role');
    `);

    await expectPreflightFailureWithoutMutation(db, /policy.*incompatible/i);
    },
  );

  it.each([false, true])(
    'preflight rechaza policy TO service_role con predicado incorrecto antes de mutar (tenant_id=%s)',
    async (withTenantColumn) => {
    const db = await database();
    await baseSchema(db, { withTenantColumn });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, marker)
      VALUES ('tenant-b', 'ORIGINAL');
      ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;
      CREATE POLICY wisp_integration_settings_service_role
        ON public.wisp_integration_settings FOR ALL
        TO service_role
        USING (false) WITH CHECK (false);
    `);

    await expectPreflightFailureWithoutMutation(db, /policy.*incompatible/i);
    },
  );

  it.each([false, true])(
    'preflight rechaza policy TO service_role sin predicados antes de mutar (tenant_id=%s)',
    async (withTenantColumn) => {
    const db = await database();
    await baseSchema(db, { withTenantColumn });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, marker)
      VALUES ('tenant-b', 'ORIGINAL');
      ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;
      CREATE POLICY wisp_integration_settings_service_role
        ON public.wisp_integration_settings FOR ALL
        TO service_role;
    `);

    await expectPreflightFailureWithoutMutation(db, /policy.*incompatible/i);
    },
  );

  it.each([false, true])(
    'preflight rechaza una segunda policy permisiva antes de mutar (tenant_id=%s)',
    async (withTenantColumn) => {
    const db = await database();
    await baseSchema(db, { withTenantColumn });
    await db.exec(`
      INSERT INTO public.tenants (id) VALUES ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, marker)
      VALUES ('tenant-b', 'ORIGINAL');
      ALTER TABLE public.wisp_integration_settings ENABLE ROW LEVEL SECURITY;
      CREATE POLICY wisp_integration_settings_service_role
        ON public.wisp_integration_settings FOR ALL
        TO service_role
        USING (true) WITH CHECK (true);
      CREATE POLICY authenticated_open
        ON public.wisp_integration_settings FOR ALL TO authenticated
        USING (true) WITH CHECK (true);
    `);

    await expectPreflightFailureWithoutMutation(db, /policy.*adicional|policies.*inesperadas/i);
    },
  );

  it('preflight rechaza DEFAULT de tenant_id desconocido antes de mutar', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`
      ALTER TABLE public.wisp_integration_settings
        ALTER COLUMN tenant_id SET DEFAULT 'unexpected-tenant';
      INSERT INTO public.tenants (id) VALUES ('tenant-b');
      INSERT INTO public.wisp_integration_settings (id, tenant_id, marker)
      VALUES ('tenant-b', 'tenant-b', 'ORIGINAL');
    `);

    await expectPreflightFailureWithoutMutation(db, /DEFAULT.*tenant_id.*incompatible/i);
  });

  it('BEGIN y ACCESS EXCLUSIVE LOCK permanecen activos tras el preflight', async () => {
    const db = await database();
    await baseSchema(db, { withTenantColumn: true });
    await db.exec(`INSERT INTO public.tenants (id) VALUES ('tenant-default');`);
    const statements = sqlStatements(migrationSql);
    expect(statements[0]).toMatch(/\bBEGIN;\s*$/i);
    expect(statements.at(-1)).toMatch(/\bCOMMIT;\s*$/i);

    await db.exec(statements[0]);
    await db.exec(statements[1]);
    const locks = await db.query<{ mode: string; granted: boolean }>(`
      SELECT mode, granted
      FROM pg_locks
      WHERE relation = 'public.wisp_integration_settings'::regclass
        AND mode = 'AccessExclusiveLock'
    `);
    expect(locks.rows).toContainEqual({ mode: 'AccessExclusiveLock', granted: true });
    await db.exec('ROLLBACK;');
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

    await expectPreflightFailureWithoutMutation(db, error);
  });
});
