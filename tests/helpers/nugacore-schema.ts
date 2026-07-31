// ====================================================================
// Aplicación de las migraciones del repo sobre un cluster hermético.
//
// Modela DOS mundos, porque el repo tiene colisiones de versión reales
// y el drift que producen es justamente lo que rompe en staging:
//
//   'full'  — se aplican TODOS los archivos en orden de nombre. Es el
//             mundo ideal: la SSOT multi-tenant SÍ corrió.
//   'drift' — se omite 20260717050000_multi_tenant_complete_ssot.sql,
//             que comparte versión con 20260717050000_olt_devices.sql y
//             por eso NUNCA se aplicó. Reproduce el esquema real
//             verificado en staging (payment_orders sin tenant_id).
//
// Una migración correcta debe funcionar en ambos. Ver MT-05.
// ====================================================================

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HermeticPg } from './hermetic-pg';

export const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');
export const PRELUDE_SQL = resolve(process.cwd(), 'tests/helpers/supabase-prelude.sql');

/**
 * Archivo que colisiona en versión con `20260717050000_olt_devices.sql`.
 * Postgres nunca lo vio en staging: el historial dice aplicado, las
 * columnas dicen que no. Es la fuente del drift de `payment_orders`.
 */
export const SSOT_SHADOWED_BY_COLLISION = '20260717050000_multi_tenant_complete_ssot.sql';

/**
 * Migraciones que NO aplican sobre una base limpia, por bugs propios y
 * ajenos a MT-05. Se omiten con motivo explícito en vez de dejar que
 * rompan una suite que no las está probando.
 *
 * - inventory_schema: `CREATE TABLE IF NOT EXISTS inventory_items` no hace
 *   nada porque init_schema ya creó la tabla sin `operational_status`, y
 *   más abajo el archivo indexa esa columna → «column "operational_status"
 *   does not exist». La reconciliación que añade la columna
 *   (20260714000000) corre DESPUÉS. En staging quedó consistente por el
 *   orden histórico de aplicación; una base nueva no puede reproducirlo.
 *   Deuda registrada, fuera del alcance de MT-05.
 */
export const BROKEN_ON_CLEAN_DB: Readonly<Record<string, string>> = {
  '20260622000000_inventory_schema.sql':
    'indexa inventory_items.operational_status antes de que 20260714000000 la añada',
};

export type SchemaMode = 'full' | 'drift';

export interface ApplyOptions {
  mode?: SchemaMode;
  /** Aplica solo migraciones con nombre < este valor (exclusivo). */
  before?: string;
  /** Nombres extra a omitir. */
  skip?: string[];
}

export const listMigrations = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

/**
 * Aplica el prelude y las migraciones seleccionadas. Lanza con el stderr
 * de psql en la primera que falle (nunca continúa a ciegas).
 */
export function applySchema(pg: HermeticPg, db: string, options: ApplyOptions = {}): string[] {
  const { mode = 'drift', before, skip = [] } = options;

  const prelude = pg.runFile(PRELUDE_SQL, db);
  if (prelude.code !== 0) {
    throw new Error(`Prelude de Supabase falló:\n${prelude.stderr}`);
  }

  const omitted = new Set([...skip, ...Object.keys(BROKEN_ON_CLEAN_DB)]);
  if (mode === 'drift') omitted.add(SSOT_SHADOWED_BY_COLLISION);

  const applied: string[] = [];
  for (const file of listMigrations()) {
    if (omitted.has(file)) continue;
    if (before && file >= before) continue;

    const res = pg.runFile(join(MIGRATIONS_DIR, file), db);
    if (res.code !== 0) {
      throw new Error(`Migración ${file} falló (exit ${res.code}):\n${res.stderr}`);
    }
    applied.push(file);
  }
  return applied;
}
