import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_MIKROTIK_ROUTER_COLUMNS,
  RECONCILIATION_PROVISIONING_COLUMNS,
  DEPRECATED_MIKROTIK_ROUTER_COLUMNS,
} from '../../backend/domains/mikrotik/provisioning/types';

// ====================================================================
// DB-1 · Reconciliación del esquema mikrotik_routers.
//
// Garantías por scan de fuente (mismo patrón que staging.migrations.test):
//  - la migración 20260618000000 cumple el CONTRATO ESTRICTO de Hermes:
//    schema-only (solo ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS);
//  - el modelo canónico (constantes TS) es coherente con la migración y con
//    el validador scripts/validate-mikrotik-schema.mjs.
// ====================================================================

const MIGRATION = 'supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql';
const VALIDATOR = 'scripts/validate-mikrotik-schema.mjs';

const sql = readFileSync(MIGRATION, 'utf8');
const validatorSrc = readFileSync(VALIDATOR, 'utf8');

describe('migración 20260618000000 — reconciliación mikrotik_routers (contrato estricto)', () => {
  it('añade cada columna de provisioning con ADD COLUMN IF NOT EXISTS', () => {
    for (const col of RECONCILIATION_PROVISIONING_COLUMNS) {
      const re = new RegExp(
        `ALTER TABLE public\\.mikrotik_routers\\s+ADD COLUMN IF NOT EXISTS\\s+${col}\\b`,
        'i',
      );
      expect(sql, `falta ADD COLUMN IF NOT EXISTS ${col}`).toMatch(re);
    }
  });

  it('crea los índices canónicos con IF NOT EXISTS (incluido connection_type)', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_status\b/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_prov_status\b/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_tower\b/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_connection_type\s+ON public\.mikrotik_routers\(connection_type\)/i,
    );
  });

  it('crea los índices DESPUÉS de garantizar las columnas', () => {
    const lastAddColumn = sql.lastIndexOf('ADD COLUMN IF NOT EXISTS');
    const firstIndex = sql.search(/CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_/i);
    expect(lastAddColumn).toBeGreaterThan(-1);
    expect(firstIndex).toBeGreaterThan(lastAddColumn);
  });

  it('solo contiene los dos tipos de statement del contrato (ALTER ADD COLUMN / CREATE INDEX)', () => {
    // Líneas con SQL ejecutable (excluye comentarios y vacías).
    const stmtLines = sql
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('--'));
    for (const line of stmtLines) {
      const okLine =
        /^ALTER TABLE public\.mikrotik_routers ADD COLUMN IF NOT EXISTS/i.test(line) ||
        /^CREATE INDEX IF NOT EXISTS/i.test(line) ||
        /^CHECK \(/i.test(line); // continuación del ADD COLUMN anterior
      expect(okLine, `línea fuera del contrato: ${line}`).toBe(true);
    }
  });

  it('NO contiene construcciones fuera del contrato de Hermes', () => {
    expect(sql, 'no debe usar DO $$').not.toMatch(/DO\s*\$\$/i);
    expect(sql, 'no debe crear triggers').not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql, 'no debe usar BEFORE UPDATE').not.toMatch(/BEFORE\s+UPDATE/i);
    expect(sql, 'no debe habilitar RLS').not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql, 'no debe usar COMMENT ON').not.toMatch(/COMMENT\s+ON/i);
  });

  it('NO contiene operaciones destructivas/DML', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    // `\bUPDATE\b` no coincide con la columna `updated_at` (identificador),
    // solo con un statement UPDATE de datos (que no debe existir).
    expect(sql).not.toMatch(/\bUPDATE\b/i);
  });

  it('no contiene CREATE INDEX sin IF NOT EXISTS', () => {
    const bad = sql
      .split('\n')
      .filter((l) => /create\s+(unique\s+)?index/i.test(l) && !/if not exists/i.test(l));
    expect(bad, `índices sin IF NOT EXISTS: ${bad.join(' | ')}`).toHaveLength(0);
  });
});

describe('DB-1 — consistencia del modelo canónico', () => {
  it('las columnas de provisioning y deprecated están dentro del modelo canónico', () => {
    for (const col of RECONCILIATION_PROVISIONING_COLUMNS) {
      expect(CANONICAL_MIKROTIK_ROUTER_COLUMNS).toContain(col);
    }
    for (const col of DEPRECATED_MIKROTIK_ROUTER_COLUMNS) {
      expect(CANONICAL_MIKROTIK_ROUTER_COLUMNS).toContain(col);
    }
  });

  it('el modelo canónico no tiene columnas duplicadas', () => {
    const set = new Set(CANONICAL_MIKROTIK_ROUTER_COLUMNS);
    expect(set.size).toBe(CANONICAL_MIKROTIK_ROUTER_COLUMNS.length);
  });

  it('cubre ambos modelos: monitoreo (init) + provisioning', () => {
    const monitoring = ['ip_address', 'is_online', 'cpu_usage_pct', 'memory_usage_pct', 'routeros_version', 'last_health_check_at'];
    const provisioning = ['connection_type', 'management_ip', 'vpn_ip', 'api_ssl_port', 'provisioning_status'];
    for (const col of [...monitoring, ...provisioning]) {
      expect(CANONICAL_MIKROTIK_ROUTER_COLUMNS).toContain(col);
    }
  });

  it('el validador valida exactamente el mismo conjunto canónico de columnas', () => {
    for (const col of CANONICAL_MIKROTIK_ROUTER_COLUMNS) {
      expect(validatorSrc, `el validador no verifica ${col}`).toContain(`'${col}'`);
    }
  });

  it('el validador es opt-in (RUN_DB_TESTS) y referencia la migración nueva', () => {
    expect(validatorSrc).toMatch(/RUN_DB_TESTS/);
    expect(validatorSrc).toContain('20260618000000_mikrotik_routers_reconciliation.sql');
  });
});
