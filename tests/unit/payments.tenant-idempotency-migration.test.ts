// ====================================================================
// Guardarraíl estático de la migración de idempotencia por WISP.
//
// La suite es hermética (sin Postgres), así que no se puede ejecutar el SQL.
// Lo que sí se puede sostener es lo que hace peligrosa a una migración de
// este tipo: que no sea reejecutable, que deje NULLs bajo un índice único, o
// que pise la FK que ya creó la migración SSOT multi-tenant.
// ====================================================================

import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260728120000_payment_events_tenant_idempotency.sql', import.meta.url),
  'utf8',
);

const indexOfOrThrow = (needle: RegExp): number => {
  const at = sql.search(needle);
  expect(at, `no se encontró ${needle}`).toBeGreaterThanOrEqual(0);
  return at;
};

describe('Migración de idempotencia por tenant — invariantes estáticas', () => {
  it('sustituye la unicidad global por la acotada al WISP', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS uq_provider_event/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_tenant_provider_event\s+ON public\.payment_events \(tenant_id, provider, provider_event_id\)/,
    );
  });

  it('el índice único no admite NULL: backfill y DESPUÉS SET NOT NULL', () => {
    const backfill = indexOfOrThrow(/UPDATE public\.payment_events SET tenant_id = 'tenant-default' WHERE tenant_id IS NULL/);
    const notNull = indexOfOrThrow(/ALTER COLUMN tenant_id SET NOT NULL/);
    const unique = indexOfOrThrow(/CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_tenant_provider_event/);

    // Un NOT NULL antes del backfill fallaría; un índice único con NULLs
    // dejaría cada NULL como distinto y perdería la idempotencia.
    expect(backfill).toBeLessThan(notNull);
    expect(notNull).toBeLessThan(unique);
  });

  it('asegura la FK a tenants con ON DELETE RESTRICT sin duplicar la de la SSOT', () => {
    expect(sql).toMatch(
      /FOREIGN KEY \(tenant_id\) REFERENCES public\.tenants\(id\) ON DELETE RESTRICT/,
    );
    // Solo la crea si no hay ya una FK sobre tenant_id.
    expect(sql).toMatch(/contype = 'f'/);
    expect(sql).toMatch(/IF has_fk THEN[\s\S]*?RETURN;/);
    // Y no revienta la migración si `tenants` aún no existe.
    expect(sql).toMatch(/EXCEPTION WHEN others THEN/);
  });

  it('añade claimed_at de forma aditiva y nullable', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ/);
    // Nullable a propósito: las filas previas no tienen claim.
    expect(sql).not.toMatch(/claimed_at TIMESTAMPTZ NOT NULL/);
  });

  it('es reejecutable: nada crea objetos sin guarda', () => {
    // Ni tablas nuevas ni índices/columnas sin IF [NOT] EXISTS.
    expect(sql).not.toMatch(/CREATE TABLE/i);
    for (const stmt of sql.match(/CREATE (UNIQUE )?INDEX[^;]*/gi) ?? []) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i);
    }
    for (const stmt of sql.match(/ADD COLUMN[^;]*/gi) ?? []) {
      expect(stmt, stmt).toMatch(/IF NOT EXISTS/i);
    }
    // Toda escritura va dentro de una guarda de existencia de la tabla.
    expect(sql).toMatch(/information_schema\.tables[\s\S]*?table_name = 'payment_events'/);
  });

  it('el token de webhook es único por WISP, ignorando filas sin token', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_wisp_integration_settings_openpay_webhook_token/,
    );
    expect(sql).toMatch(/WHERE openpay_webhook_token IS NOT NULL AND openpay_webhook_token <> ''/);
  });
});
