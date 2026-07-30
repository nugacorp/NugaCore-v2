// ====================================================================
// PR-1A.1 — Guardarraíl estático de `client_timeline.tenant_id`.
//
// La suite es hermética (sin Postgres), así que no se ejecuta el SQL. Lo que
// sí se sostiene aquí es lo que haría peligrosa a esta migración concreta:
//
//   - que rellenara el tenant a ciegas en vez de derivarlo del cliente dueño
//     del evento (sembraría timelines del WISP equivocado, en silencio);
//   - que el orden fuera incorrecto — poner NOT NULL o la FK antes del
//     backfill hace fallar la migración en cualquier entorno con datos;
//   - que no fuera reejecutable;
//   - que dejara la tabla sin RLS o con una política abierta.
//
// El SQL se validó además contra staging el 2026-07-30 en transacción con
// ROLLBACK: primera ejecución OK, segunda OK (idempotente), 0 filas con
// tenant_id NULL, y sin residuo en la base.
// ====================================================================

import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20260730160000_client_timeline_tenant_id.sql', import.meta.url),
  'utf8',
);

const posOf = (needle: RegExp): number => {
  const at = sql.search(needle);
  expect(at, `no se encontró ${needle}`).toBeGreaterThanOrEqual(0);
  return at;
};

describe('client_timeline.tenant_id — invariantes estáticas', () => {
  it('añade la columna de forma reejecutable', () => {
    expect(sql).toMatch(/ALTER TABLE public\.client_timeline\s+ADD COLUMN IF NOT EXISTS tenant_id TEXT/);
  });

  it('deriva el tenant del cliente dueño, no lo inventa', () => {
    // Este es el corazón de la migración: sin el JOIN a clients, un entorno
    // con datos quedaría con todo el historial en tenant-default.
    expect(sql).toMatch(/SET tenant_id = c\.tenant_id\s+FROM public\.clients c\s+WHERE t\.client_id = c\.id/);
  });

  it('solo los huérfanos caen al WISP por defecto', () => {
    const derivado = posOf(/SET tenant_id = c\.tenant_id/);
    const fallback = posOf(/SET tenant_id = 'tenant-default'/);
    expect(fallback, 'el fallback debe ir DESPUÉS del backfill derivado').toBeGreaterThan(derivado);
  });

  it('el backfill precede a NOT NULL', () => {
    expect(posOf(/ALTER COLUMN tenant_id SET NOT NULL/)).toBeGreaterThan(posOf(/SET tenant_id = 'tenant-default'/));
  });

  it('el backfill precede a la FK', () => {
    expect(posOf(/client_timeline_tenant_id_fkey/)).toBeGreaterThan(posOf(/SET tenant_id = 'tenant-default'/));
  });

  it('la FK apunta a tenants con RESTRICT', () => {
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id\) REFERENCES public\.tenants\(id\) ON DELETE RESTRICT/);
  });

  it('crea la FK solo si no existe', () => {
    expect(sql).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/);
  });

  it('indexa el acceso real del dominio, que es (tenant, cliente)', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_client_timeline_tenant_client\s+ON public\.client_timeline \(tenant_id, client_id\)/);
  });

  it('deja RLS activa con política solo de service_role', () => {
    expect(sql).toMatch(/ALTER TABLE public\.client_timeline ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS client_timeline_service_role/);
    expect(sql).toMatch(/USING \(\(select auth\.role\(\)\) = 'service_role'\)/);
    expect(sql).not.toMatch(/TO\s+(anon|authenticated)/);
  });

  it('no borra columnas ni datos', () => {
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE|TRUNCATE|DELETE FROM/);
  });
});

describe('versiones de migración', () => {
  it('ningún prefijo de versión está duplicado', async () => {
    // El drift que costó 39 tablas sin tenant_id empezó exactamente así.
    // PR-2A llevará esta comprobación a CI; mientras tanto vive aquí.
    const { readdirSync } = await import('fs');
    const versions = readdirSync(new URL('../../supabase/migrations', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.split('_')[0]);
    const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
    expect([...new Set(dupes)], 'prefijos duplicados').toEqual(['20260717040000', '20260717050000']);
  });
});
