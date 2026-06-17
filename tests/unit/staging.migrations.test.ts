import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Hotfix migraciones staging — garantías de idempotencia/seguridad por
// scan de fuente (mismo patrón que staging.serve-mode / login.hardening).
//
// Asegura que dos migraciones que reventaban en staging queden:
//  - mikrotik_provisioning_schema: EVOLUTIVA (ALTER ADD COLUMN IF NOT
//    EXISTS) en vez de redefinir mikrotik_routers con CREATE TABLE.
//  - billing_data_migration: el seed mock verifica c-1..c-5 y nunca crea
//    clientes ni inserta facturas huérfanas.
// ====================================================================

const MIK = 'supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql';
const BILL = 'supabase/migrations/20260604000001_billing_data_migration.sql';

const mikrotikSql = readFileSync(MIK, 'utf8');
const billingSql = readFileSync(BILL, 'utf8');

// Columnas de provisioning que DEBEN añadirse vía ALTER (no en CREATE TABLE).
const PROVISIONING_COLUMNS = [
  'status',
  'connection_type',
  'vpn_ip',
  'api_port',
  'has_credentials',
  'provisioning_status',
  'last_seen_at',
  'notes',
  'updated_at',
];

describe('mikrotik_provisioning_schema — migración evolutiva e idempotente', () => {
  it('añade cada columna de provisioning con ADD COLUMN IF NOT EXISTS', () => {
    for (const col of PROVISIONING_COLUMNS) {
      const re = new RegExp(
        `ALTER TABLE public\\.mikrotik_routers\\s+ADD COLUMN IF NOT EXISTS\\s+${col}\\b`,
        'i',
      );
      expect(mikrotikSql, `falta ADD COLUMN IF NOT EXISTS ${col}`).toMatch(re);
    }
  });

  it('NO depende de CREATE TABLE para las columnas nuevas (CREATE TABLE de mikrotik_routers es mínimo)', () => {
    // Aísla el bloque CREATE TABLE … mikrotik_routers ( … ); y verifica que
    // NO declare columnas de provisioning ahí dentro.
    const createBlock = mikrotikSql.match(
      /CREATE TABLE IF NOT EXISTS public\.mikrotik_routers\s*\(([\s\S]*?)\);/i,
    );
    expect(createBlock, 'no se encontró el CREATE TABLE de mikrotik_routers').not.toBeNull();
    const body = createBlock![1];
    for (const col of ['status', 'connection_type', 'provisioning_status', 'has_credentials']) {
      expect(body, `el CREATE TABLE no debe declarar ${col}`).not.toMatch(
        new RegExp(`\\b${col}\\b`, 'i'),
      );
    }
  });

  it('crea los índices con IF NOT EXISTS (incluido status)', () => {
    expect(mikrotikSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status\s+ON public\.mikrotik_routers\(status\)/i,
    );
    expect(mikrotikSql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_prov_status/i);
  });

  it('no contiene CREATE INDEX sin IF NOT EXISTS', () => {
    const bad = mikrotikSql
      .split('\n')
      .filter((l) => /create\s+(unique\s+)?index/i.test(l) && !/if not exists/i.test(l));
    expect(bad, `índices sin IF NOT EXISTS: ${bad.join(' | ')}`).toHaveLength(0);
  });

  it('mantiene las tablas auxiliares con CREATE TABLE IF NOT EXISTS', () => {
    for (const t of [
      'mikrotik_router_credentials',
      'mikrotik_provisioning_tokens',
      'mikrotik_provisioning_scripts',
      'mikrotik_command_audit',
    ]) {
      expect(mikrotikSql).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`, 'i'),
      );
    }
  });

  it('mantiene RLS deny-by-default (ENABLE ROW LEVEL SECURITY)', () => {
    expect(mikrotikSql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

describe('billing_data_migration — seed mock seguro', () => {
  it('el seed verifica que existan los 5 clientes (c-1..c-5) antes de sembrar', () => {
    for (const id of ['c-1', 'c-2', 'c-3', 'c-4', 'c-5']) {
      expect(billingSql).toContain(`'${id}'`);
    }
    // Cuenta los clientes mock y exige los 5 (umbral < 5 → omite).
    expect(billingSql).toMatch(/COUNT\(\*\)\s+INTO\s+mock_clients/i);
    expect(billingSql).toMatch(/mock_clients\s*<\s*5/);
  });

  it('NO crea clientes mock automáticamente', () => {
    expect(billingSql).not.toMatch(/INSERT\s+INTO\s+public\.clients\b/i);
  });

  it('si faltan clientes, omite el seed con NOTICE y RETURN (no falla)', () => {
    expect(billingSql).toMatch(/RAISE NOTICE[\s\S]*OMITIDO/i);
    expect(billingSql).toMatch(/IF mock_clients < 5 THEN[\s\S]*?RETURN;/);
  });

  it('mantiene el backfill de *_cents (idempotente)', () => {
    expect(billingSql).toMatch(/UPDATE public\.invoices[\s\S]*total_cents\s*=/i);
    expect(billingSql).toMatch(/WHERE total_cents = 0\s+AND amount > 0/i);
  });

  it('mantiene la migración legacy de invoice_payments y usa ON CONFLICT DO NOTHING', () => {
    expect(billingSql).toMatch(/INSERT INTO public\.payments\b/i);
    expect(billingSql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
  });
});

describe('mikrotik_command_audit — migración evolutiva sobre esquema legacy', () => {
  const NEW_COLUMNS = [
    'action',
    'dry_run',
    'actor_id',
    'request_payload',
    'result_summary',
    'error_message',
    'updated_at',
  ];
  const LEGACY_COLUMNS = ['command', 'mode', 'executed_by', 'message'];

  it('añade las columnas nuevas con ADD COLUMN IF NOT EXISTS (incluida action)', () => {
    for (const col of NEW_COLUMNS) {
      expect(mikrotikSql, `falta ADD COLUMN IF NOT EXISTS ${col}`).toMatch(
        new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i'),
      );
    }
  });

  it('NO depende solo de CREATE TABLE para las columnas nuevas (CREATE TABLE es mínimo)', () => {
    const createBlock = mikrotikSql.match(
      /CREATE TABLE IF NOT EXISTS public\.mikrotik_command_audit\s*\(([\s\S]*?)\);/i,
    );
    expect(createBlock, 'no se encontró el CREATE TABLE de mikrotik_command_audit').not.toBeNull();
    const body = createBlock![1];
    for (const col of ['action', 'dry_run', 'request_payload', 'result_summary']) {
      expect(body, `el CREATE TABLE no debe declarar ${col}`).not.toMatch(
        new RegExp(`\\b${col}\\b`, 'i'),
      );
    }
  });

  it('crea el índice sobre action DESPUÉS de garantizar la columna', () => {
    const addAction = mikrotikSql.indexOf('ADD COLUMN IF NOT EXISTS action');
    const idxAction = mikrotikSql.search(/CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_action/i);
    expect(addAction).toBeGreaterThan(-1);
    expect(idxAction).toBeGreaterThan(addAction);
    expect(mikrotikSql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_mikrotik_audit_action\s+ON public\.mikrotik_command_audit\(action\)/i,
    );
  });

  it('NO contiene DROP TABLE ni DROP COLUMN (no destructivo)', () => {
    expect(mikrotikSql).not.toMatch(/DROP TABLE/i);
    expect(mikrotikSql).not.toMatch(/DROP COLUMN/i);
  });

  it('conserva las columnas legacy (referenciadas en el backfill, nunca eliminadas)', () => {
    for (const col of LEGACY_COLUMNS) {
      expect(mikrotikSql, `el SQL debe referenciar la columna legacy ${col}`).toMatch(
        new RegExp(`\\b${col}\\b`, 'i'),
      );
    }
  });

  it('el backfill desde legacy está protegido por guards de information_schema', () => {
    expect(mikrotikSql).toMatch(/information_schema\.columns/i);
    expect(mikrotikSql).toMatch(/SET action = command/i);
    expect(mikrotikSql).toMatch(/SET actor_id = executed_by/i);
    expect(mikrotikSql).toMatch(/jsonb_build_object\('message', message\)/i);
  });
});
