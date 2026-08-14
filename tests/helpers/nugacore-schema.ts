// ====================================================================
// Aplicación de las migraciones del repo sobre un cluster hermético.
//
// Modela DOS mundos: la historia real de staging tuvo una colisión de versión
// ya normalizada en Git, y algunos tests siguen reproduciendo ese drift:
//
//   'full'  — se aplican TODOS los archivos en orden de nombre. Es el
//             mundo ideal: la SSOT multi-tenant SÍ corrió.
//   'drift' — se omite 20260717050001_multi_tenant_complete_ssot.sql,
//             porque su efecto histórico quedó registrado en staging bajo
//             otra identidad. Reproduce el esquema real verificado antes de
//             la reconciliación (payment_orders sin tenant_id).
//
// Una migración correcta debe funcionar en ambos. Ver MT-05.
// ====================================================================

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { HermeticPg } from './hermetic-pg';

export const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');
export const PRELUDE_SQL = resolve(process.cwd(), 'tests/helpers/supabase-prelude.sql');

/**
 * Archivo SSOT cuya ejecución histórica no ocurrió bajo su identidad
 * canonical actual en staging. Es la fuente del drift de `payment_orders`
 * que las migraciones MT-05 deben tolerar.
 */
export const SSOT_SHADOWED_BY_COLLISION = '20260717050001_multi_tenant_complete_ssot.sql';

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

  const omitted = new Set(skip);
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
