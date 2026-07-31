import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findPgBinDir, startHermeticPg, type HermeticPg } from '../helpers/hermetic-pg';
import { applySchema } from '../helpers/nugacore-schema';

// ====================================================================
// MT-05 — Postgres debe RECHAZAR relaciones cruzadas entre WISPs.
//
// Estas pruebas no leen el .sql: lo EJECUTAN contra un Postgres real y
// efímero (ver tests/helpers/hermetic-pg.ts). Un scan estático prueba
// que la constraint está escrita; solo un INSERT prueba que rechaza.
//
// Opt-in: RUN_PG_LOCAL_TESTS=true (Vitest objetivo). Sin el flag se
// omite y `npm test` sigue siendo hermético y sin binarios locales.
// Con el flag y sin binarios, falla en voz alta (nunca omite en silencio).
// ====================================================================

const OPT_IN = process.env.RUN_PG_LOCAL_TESTS === 'true';
const PG_BIN = findPgBinDir();

const MIGRATION = '20260731043206_payment_engine_composite_tenant_fks.sql';
const MIGRATION_PATH = `supabase/migrations/${MIGRATION}`;
const ROLLBACK_PATH = `supabase/rollbacks/20260731043206_payment_engine_composite_tenant_fks.down.sql`;

const BOOT_TIMEOUT_MS = 600_000;
const CASE_TIMEOUT_MS = 180_000;

if (OPT_IN && !PG_BIN) {
  describe('MT-05 FKs compuestas — configuración requerida', () => {
    it('RUN_PG_LOCAL_TESTS=true exige binarios de PostgreSQL', () => {
      throw new Error(
        'RUN_PG_LOCAL_TESTS=true pero no se encontró initdb/postgres. ' +
          'Instala PostgreSQL o define PG_BIN_DIR.',
      );
    });
  });
}

// Dos WISPs, cada uno con su cliente y su factura. Todo el ticket se
// juega sobre estas seis filas.
const FIXTURE = `
  INSERT INTO public.tenants (id, name, slug) VALUES
    ('tenant-a', 'WISP A', 'wisp-a'),
    ('tenant-b', 'WISP B', 'wisp-b')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.clients (id, full_name, address, city, tenant_id) VALUES
    ('cli-a', 'Cliente A', 'Calle 1', 'Ciudad', 'tenant-a'),
    ('cli-b', 'Cliente B', 'Calle 2', 'Ciudad', 'tenant-b');

  INSERT INTO public.invoices (id, client_id, client_name, amount, due_date, tenant_id) VALUES
    ('inv-a', 'cli-a', 'Cliente A', 100.00, '2026-08-01', 'tenant-a'),
    ('inv-b', 'cli-b', 'Cliente B', 100.00, '2026-08-01', 'tenant-b');
`;

const insertOrder = (id: string, tenant: string, invoice: string, customer: string) => `
  INSERT INTO public.payment_orders
    (id, tenant_id, customer_id, invoice_id, provider, amount_cents, status)
  VALUES ('${id}', '${tenant}', '${customer}', '${invoice}', 'openpay', 10000, 'pending');
`;

const insertEvent = (id: string, tenant: string, orderId: string | null) => `
  INSERT INTO public.payment_events
    (id, tenant_id, provider, provider_event_id, event_type, payment_order_id)
  VALUES ('${id}', '${tenant}', 'openpay', 'evt-${id}', 'charge.succeeded',
          ${orderId === null ? 'NULL' : `'${orderId}'`});
`;

describe.skipIf(!OPT_IN || !PG_BIN)('MT-05 — FKs compuestas por tenant (Postgres hermético)', () => {
  let pg: HermeticPg;

  /** Crea una base a partir de una plantilla ya migrada (barato). */
  const fork = (template: string, name: string): string => {
    pg.exec(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    return name;
  };

  const constraintDef = (db: string, name: string): string =>
    pg.scalar(
      `SELECT COALESCE(
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = '${name}'),
         '<ausente>')`,
      db,
    );

  const hasColumn = (db: string, table: string, column: string): boolean =>
    pg.scalar(
      `SELECT count(*)::text FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}'`,
      db,
    ) === '1';

  const indexDef = (db: string, name: string): string =>
    pg.scalar(
      `SELECT COALESCE(
         (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = '${name}'),
         '<ausente>')`,
      db,
    );

  beforeAll(async () => {
    pg = await startHermeticPg();

    // Plantilla 'drift': reproduce el esquema REAL de staging — la SSOT
    // multi-tenant quedó sombreada por la colisión de versión, así que
    // payment_orders NUNCA recibió tenant_id.
    pg.exec('CREATE DATABASE base_drift');
    applySchema(pg, 'base_drift', { mode: 'drift', before: MIGRATION });

    // Plantilla 'full': el mundo ideal donde la SSOT sí corrió y
    // payment_orders.tenant_id ya existe. La migración debe ser idempotente
    // sobre ese estado, no asumir que la columna falta.
    pg.exec('CREATE DATABASE base_full');
    applySchema(pg, 'base_full', { mode: 'full', before: MIGRATION });
  }, BOOT_TIMEOUT_MS);

  afterAll(() => {
    pg?.stop();
  });

  it(
    'el esquema previo REAL no tiene payment_orders.tenant_id (drift confirmado)',
    () => {
      expect(hasColumn('base_drift', 'payment_orders', 'tenant_id')).toBe(false);
      expect(hasColumn('base_drift', 'payment_events', 'tenant_id')).toBe(true);
      expect(hasColumn('base_drift', 'invoices', 'tenant_id')).toBe(true);
      // En el mundo sin colisión la columna sí está.
      expect(hasColumn('base_full', 'payment_orders', 'tenant_id')).toBe(true);
    },
    CASE_TIMEOUT_MS,
  );

  describe.each([
    ['upgrade desde el esquema previo con drift', 'base_drift'],
    ['upgrade desde el esquema previo completo', 'base_full'],
  ])('%s', (label, template) => {
    const db = `mt05_${template}`;

    beforeAll(() => {
      fork(template, db);
      const res = pg.runFile(MIGRATION_PATH, db);
      expect(res.code, `la migración falló:\n${res.stderr}`).toBe(0);
      pg.exec(FIXTURE, db);
    }, CASE_TIMEOUT_MS);

    it('crea las claves únicas padre (tenant_id, id)', () => {
      expect(constraintDef(db, 'uq_clients_tenant_id_id')).toBe('UNIQUE (tenant_id, id)');
      expect(constraintDef(db, 'uq_invoices_tenant_id_id')).toBe('UNIQUE (tenant_id, id)');
      expect(constraintDef(db, 'uq_payment_orders_tenant_id_id')).toBe('UNIQUE (tenant_id, id)');
    });

    it('crea las FKs compuestas y retira las de una sola columna', () => {
      expect(constraintDef(db, 'payment_orders_tenant_invoice_fkey')).toBe(
        'FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoices(tenant_id, id) ON DELETE RESTRICT',
      );
      expect(constraintDef(db, 'payment_events_tenant_order_fkey')).toBe(
        'FOREIGN KEY (tenant_id, payment_order_id) REFERENCES payment_orders(tenant_id, id) ON DELETE RESTRICT',
      );
      expect(constraintDef(db, 'invoices_tenant_client_fkey')).toBe(
        'FOREIGN KEY (tenant_id, client_id) REFERENCES clients(tenant_id, id) ON DELETE CASCADE',
      );
      expect(constraintDef(db, 'payment_orders_tenant_customer_fkey')).toBe(
        'FOREIGN KEY (tenant_id, customer_id) REFERENCES clients(tenant_id, id) ON DELETE RESTRICT',
      );
      // Redundantes una vez validadas las compuestas.
      expect(constraintDef(db, 'payment_orders_invoice_id_fkey')).toBe('<ausente>');
      expect(constraintDef(db, 'payment_events_payment_order_id_fkey')).toBe('<ausente>');
    });

    it('indexa el lado hijo de cada FK compuesta', () => {
      expect(indexDef(db, 'idx_invoices_tenant_client')).toMatch(/\(tenant_id, client_id\)$/);
      expect(indexDef(db, 'idx_payment_orders_tenant_customer')).toMatch(
        /\(tenant_id, customer_id\)$/,
      );
      expect(indexDef(db, 'idx_payment_orders_tenant_invoice')).toMatch(
        /\(tenant_id, invoice_id\)$/,
      );
      expect(indexDef(db, 'idx_payment_events_tenant_order')).toMatch(
        /\(tenant_id, payment_order_id\)$/,
      );
    });

    it('payment_orders.tenant_id queda NOT NULL y anclado a tenants', () => {
      expect(
        pg.scalar(
          `SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name='payment_orders' AND column_name='tenant_id'`,
          db,
        ),
      ).toBe('NO');
      expect(constraintDef(db, 'payment_orders_tenant_id_fkey')).toBe(
        'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT',
      );
    });

    it('ACEPTA A→A: order del tenant A sobre factura del tenant A', () => {
      const res = pg.run(insertOrder('po-aa', 'tenant-a', 'inv-a', 'cli-a'), db);
      expect(res.code, res.stderr).toBe(0);
    });

    it('RECHAZA A→B: order del tenant A sobre factura del tenant B', () => {
      // customer permanece en A para aislar exactamente order→invoice.
      const res = pg.run(insertOrder('po-ab', 'tenant-a', 'inv-b', 'cli-a'), db);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/payment_orders_tenant_invoice_fkey/);
      expect(res.stderr).toMatch(/violates foreign key constraint/i);
    });

    it('RECHAZA mover una order existente a la factura de otro WISP', () => {
      const res = pg.run(`UPDATE public.payment_orders SET invoice_id='inv-b' WHERE id='po-aa'`, db);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/payment_orders_tenant_invoice_fkey/);
    });

    it('ACEPTA A→A: event del tenant A sobre order del tenant A', () => {
      const res = pg.run(insertEvent('pe-aa', 'tenant-a', 'po-aa'), db);
      expect(res.code, res.stderr).toBe(0);
    });

    it('RECHAZA A→B: event del tenant B sobre order del tenant A', () => {
      const res = pg.run(insertEvent('pe-ba', 'tenant-b', 'po-aa'), db);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/payment_events_tenant_order_fkey/);
    });

    it('service_role no puede saltarse las FKs compuestas', () => {
      pg.exec(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients, public.invoices,
           public.payment_orders, public.payment_events TO service_role`,
        db,
      );
      const valid = pg.run(
        `SET ROLE service_role; ${insertOrder('po-service-aa', 'tenant-a', 'inv-a', 'cli-a')}`,
        db,
      );
      expect(valid.code, valid.stderr).toBe(0);

      const crossed = pg.run(
        `SET ROLE service_role; ${insertEvent('pe-service-ba', 'tenant-b', 'po-service-aa')}`,
        db,
      );
      expect(crossed.code).not.toBe(0);
      expect(crossed.stderr).toMatch(/payment_events_tenant_order_fkey/);
    });

    it('ACEPTA un event sin order (payment_order_id NULL sigue siendo válido)', () => {
      const res = pg.run(insertEvent('pe-null', 'tenant-b', null), db);
      expect(res.code, res.stderr).toBe(0);
    });

    it('RECHAZA borrar la factura padre mientras exista la order (RESTRICT)', () => {
      const res = pg.run(`DELETE FROM public.invoices WHERE id='inv-a'`, db);
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/payment_orders_tenant_invoice_fkey/);
    });

    it('es idempotente: re-ejecutar la migración no falla ni duplica', () => {
      const again = pg.runFile(MIGRATION_PATH, db);
      expect(again.code, again.stderr).toBe(0);
      expect(
        pg.scalar(
          `SELECT count(*)::text FROM pg_constraint
            WHERE conname IN ('payment_orders_tenant_invoice_fkey','payment_events_tenant_order_fkey')`,
          db,
        ),
      ).toBe('2');
    });
  });

  describe('preflight: aborta ANTES de mutar nada', () => {
    it(
      'con un customer huerfano, falla reportando cantidades antes del DDL',
      () => {
        const db = fork('base_full', 'mt05_preflight_orphan');
        pg.exec(FIXTURE, db);
        // customer_id no tenia FK en el esquema previo, por eso este
        // huerfano es representable y debe ser detectado por MT-05.
        pg.exec(insertOrder('po-orphan', 'tenant-a', 'inv-a', 'cli-missing'), db);

        const res = pg.runFile(MIGRATION_PATH, db);

        expect(res.code).not.toBe(0);
        expect(res.stderr).toMatch(/payment_orders huerfanas=1/);
        expect(constraintDef(db, 'uq_clients_tenant_id_id')).toBe('<ausente>');
        expect(constraintDef(db, 'payment_orders_tenant_customer_fkey')).toBe('<ausente>');
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'con una order cruzada preexistente, falla reportando cantidades y no toca el esquema',
      () => {
        const db = fork('base_full', 'mt05_preflight_cross');
        pg.exec(FIXTURE, db);
        // tenant-a apuntando a la factura de tenant-b: exactamente lo que
        // hoy Postgres permite y la migración debe negarse a "arreglar".
        pg.exec(insertOrder('po-cross', 'tenant-a', 'inv-b', 'cli-b'), db);

        const res = pg.runFile(MIGRATION_PATH, db);

        expect(res.code).not.toBe(0);
        expect(res.stderr).toMatch(/MT-05/);
        expect(res.stderr).toMatch(/payment_orders cruzados=1/);

        // Nada mutado: sin uniques, sin FKs compuestas, y la FK original intacta.
        expect(constraintDef(db, 'uq_invoices_tenant_id_id')).toBe('<ausente>');
        expect(constraintDef(db, 'uq_payment_orders_tenant_id_id')).toBe('<ausente>');
        expect(constraintDef(db, 'payment_orders_tenant_invoice_fkey')).toBe('<ausente>');
        expect(constraintDef(db, 'payment_orders_invoice_id_fkey')).toBe(
          'FOREIGN KEY (invoice_id) REFERENCES invoices(id)',
        );
        // Y el dato ambiguo sigue ahí, sin corregir.
        expect(
          pg.scalar(`SELECT tenant_id FROM public.payment_orders WHERE id='po-cross'`, db),
        ).toBe('tenant-a');
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'con un event cruzado preexistente, falla reportando cantidades',
      () => {
        const db = fork('base_full', 'mt05_preflight_event');
        pg.exec(FIXTURE, db);
        pg.exec(insertOrder('po-ok', 'tenant-a', 'inv-a', 'cli-a'), db);
        pg.exec(insertEvent('pe-cross', 'tenant-b', 'po-ok'), db);

        const res = pg.runFile(MIGRATION_PATH, db);

        expect(res.code).not.toBe(0);
        expect(res.stderr).toMatch(/payment_events cruzados=1/);
        expect(constraintDef(db, 'payment_events_tenant_order_fkey')).toBe('<ausente>');
      },
      CASE_TIMEOUT_MS,
    );

    it(
      'sobre el esquema con drift, deriva el tenant de la factura y detecta el cruce con el event',
      () => {
        const db = fork('base_drift', 'mt05_preflight_drift');
        pg.exec(FIXTURE, db);
        // Sin tenant_id en payment_orders todavía: el tenant se derivará de
        // la factura (inv-b → tenant-b), así que este event de tenant-a
        // quedaría cruzado. El preflight debe verlo ANTES del backfill.
        pg.exec(
          `INSERT INTO public.payment_orders (id, customer_id, invoice_id, provider, amount_cents, status)
           VALUES ('po-drift', 'cli-b', 'inv-b', 'openpay', 10000, 'pending')`,
          db,
        );
        pg.exec(insertEvent('pe-drift', 'tenant-a', 'po-drift'), db);

        const res = pg.runFile(MIGRATION_PATH, db);

        expect(res.code).not.toBe(0);
        expect(res.stderr).toMatch(/payment_events cruzados=1/);
        // Ni siquiera se creó la columna: falló antes de cualquier DDL.
        expect(hasColumn(db, 'payment_orders', 'tenant_id')).toBe(false);
      },
      CASE_TIMEOUT_MS,
    );
  });

  describe('rollback', () => {
    it(
      'revierte a las FKs de una sola columna sin dejar ventana sin integridad',
      () => {
        const db = fork('base_full', 'mt05_rollback');
        pg.exec(FIXTURE, db);
        expect(pg.runFile(MIGRATION_PATH, db).code).toBe(0);

        const down = pg.runFile(ROLLBACK_PATH, db);
        expect(down.code, down.stderr).toBe(0);

        // Compuestas fuera, simples de vuelta: invoice_id sigue protegido.
        expect(constraintDef(db, 'payment_orders_tenant_invoice_fkey')).toBe('<ausente>');
        expect(constraintDef(db, 'payment_events_tenant_order_fkey')).toBe('<ausente>');
        expect(constraintDef(db, 'payment_orders_invoice_id_fkey')).toBe(
          'FOREIGN KEY (invoice_id) REFERENCES invoices(id)',
        );
        expect(constraintDef(db, 'payment_events_payment_order_id_fkey')).toBe(
          'FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id)',
        );

        // El rollback NO borra datos ni la columna tenant_id.
        expect(hasColumn(db, 'payment_orders', 'tenant_id')).toBe(true);

        // Tras revertir, el cruce vuelve a ser aceptado: es exactamente el
        // riesgo que reintroduce el rollback, y queda demostrado.
        expect(pg.run(insertOrder('po-post', 'tenant-a', 'inv-b', 'cli-b'), db).code).toBe(0);

        // Y volver a aplicar la migración detecta ese cruce en el preflight.
        const reapply = pg.runFile(MIGRATION_PATH, db);
        expect(reapply.code).not.toBe(0);
        expect(reapply.stderr).toMatch(/payment_orders cruzados=1/);
      },
      CASE_TIMEOUT_MS,
    );
  });
});
