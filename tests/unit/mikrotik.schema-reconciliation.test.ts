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
//  - la migración 20260618000000 es EVOLUTIVA, idempotente y NO destructiva;
//  - el modelo canónico (constantes TS) es coherente con la migración y con
//    el validador scripts/validate-mikrotik-schema.mjs.
// ====================================================================

const MIGRATION = 'supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql';
const VALIDATOR = 'scripts/validate-mikrotik-schema.mjs';

const sql = readFileSync(MIGRATION, 'utf8');
const validatorSrc = readFileSync(VALIDATOR, 'utf8');

// SQL sin líneas de comentario `--` (evita falsos positivos de las reglas
// documentadas en la cabecera al buscar operaciones destructivas).
const sqlCode = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

describe('migración 20260618000000 — reconciliación mikrotik_routers', () => {
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

  it('no contiene CREATE INDEX sin IF NOT EXISTS', () => {
    const bad = sqlCode
      .split('\n')
      .filter((l) => /create\s+(unique\s+)?index/i.test(l) && !/if not exists/i.test(l));
    expect(bad, `índices sin IF NOT EXISTS: ${bad.join(' | ')}`).toHaveLength(0);
  });

  it('es NO destructiva: sin DROP/DELETE/TRUNCATE/INSERT/UPDATE de datos', () => {
    expect(sqlCode).not.toMatch(/DROP\s+TABLE/i);
    expect(sqlCode).not.toMatch(/DROP\s+COLUMN/i);
    expect(sqlCode).not.toMatch(/\bDELETE\s+FROM/i);
    expect(sqlCode).not.toMatch(/\bTRUNCATE\b/i);
    expect(sqlCode).not.toMatch(/\bINSERT\s+INTO/i);
    // No hay UPDATE de datos de la tabla (el trigger usa BEFORE UPDATE, no es DML).
    expect(sqlCode).not.toMatch(/\bUPDATE\s+(public\.)?mikrotik_routers\b/i);
  });

  it('documenta canónico vs deprecated con COMMENT (metadata, no datos)', () => {
    expect(sql).toMatch(/COMMENT ON COLUMN public\.mikrotik_routers\.provisioning_status/i);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.mikrotik_routers\.status/i);
    expect(sql).toMatch(/COMMENT ON COLUMN public\.mikrotik_routers\.management_ip/i);
    expect(sql).toMatch(/DEPRECATED/);
  });

  it('mantiene RLS deny-by-default (ENABLE ROW LEVEL SECURITY)', () => {
    expect(sqlCode).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it('crea los índices DESPUÉS de garantizar las columnas', () => {
    const lastAddColumn = sql.lastIndexOf('ADD COLUMN IF NOT EXISTS');
    const firstIndex = sql.search(/CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_/i);
    expect(lastAddColumn).toBeGreaterThan(-1);
    expect(firstIndex).toBeGreaterThan(lastAddColumn);
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
