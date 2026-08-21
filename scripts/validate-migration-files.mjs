#!/usr/bin/env node
// ====================================================================
// NugaCore — validador de nombres de migración (B6).
//
// HERMÉTICO POR DISEÑO:
//   - Sólo mira nombres de archivo bajo supabase/migrations.
//   - No lee variables de base de datos ni credenciales.
//   - No se conecta a Supabase ni ejecuta SQL.
//   - Determinista: la misma entrada produce la misma salida ordenada.
//
// POR QUÉ EXISTE
//
// El historial de migraciones de Supabase admite UNA fila por versión. Dos
// archivos con el mismo prefijo de 14 dígitos significan, por tanto, que uno
// de los dos queda sin ejecutar y sin posibilidad de ejecutarse: la versión ya
// consta como consumida y cualquier aplicación futura la salta para siempre.
//
// Eso pasó de verdad. `20260717050000` la ocuparon a la vez `olt_devices` y
// `multi_tenant_complete_ssot`; se registró la primera y el SSOT multi-tenant
// nunca se aplicó. 39 de 42 tablas se quedaron sin `tenant_id` y `/api/…`
// respondía 500 en staging. Se detectó 22 días después.
//
// `report-migration-drift.mjs` puede observar duplicados, pero está orientado
// al drift contra una base remota y puede requerir configuración de DB. Este
// validador es la guarda local obligatoria que corre en CI antes de la suite
// pesada, sin depender de nada externo.
//
// NO valida contenido SQL, ni orden lógico, ni si la migración está aplicada
// en algún ambiente. Sólo el contrato de nombres.
// ====================================================================

import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Ruta por defecto de las migraciones, relativa a la raíz del repo. */
export const MIGRATIONS_DIR = resolve(HERE, '..', 'supabase', 'migrations');

/**
 * Contrato: `YYYYMMDDHHMMSS_descripcion.sql`
 *
 * - 14 dígitos exactos de versión.
 * - Un guion bajo separador.
 * - Descripción en minúsculas, dígitos y guiones bajos; debe empezar por
 *   letra o dígito (nada de `__doble`).
 * - Extensión `.sql` en minúsculas.
 */
export const MIGRATION_FILENAME_PATTERN = /^\d{14}_[a-z0-9][a-z0-9_]*\.sql$/;

/**
 * Versión de un nombre bien formado. Exige que tras los 14 dígitos venga el
 * separador, así un prefijo de 15 dígitos no se recorta a 14 y finge colisión.
 */
const versionOf = (filename) => {
  const match = /^(\d{14})_/.exec(filename);
  return match ? match[1] : null;
};

/** Lee los nombres `.sql` del directorio de migraciones (ordenados). */
export function listMigrationFilenames(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort();
}

/**
 * Valida una lista de nombres. Devuelve TODOS los incumplimientos, ordenados,
 * en vez de detenerse en el primero: quien lo ejecute quiere la lista completa.
 *
 * Una lista vacía es un FALLO deliberado. Un PASS con cero migraciones casi
 * siempre significa que la ruta era incorrecta, no que el repo esté limpio.
 */
export function validateMigrationFilenames(filenames) {
  const errors = [];

  if (!Array.isArray(filenames) || filenames.length === 0) {
    errors.push(
      'No se encontró ninguna migración .sql. Un PASS sin migraciones suele '
      + 'significar que la ruta es incorrecta, así que se trata como fallo.',
    );
    return { ok: false, errors, total: 0, versions: [] };
  }

  const malformed = filenames
    .filter((name) => !MIGRATION_FILENAME_PATTERN.test(name))
    .sort();

  for (const name of malformed) {
    errors.push(
      `Nombre inválido: ${name}. Debe cumplir YYYYMMDDHHMMSS_descripcion.sql `
      + '(14 dígitos, guion bajo, descripción en minúsculas con dígitos o guiones bajos).',
    );
  }

  const byVersion = new Map();
  for (const name of filenames) {
    const version = versionOf(name);
    if (!version) continue;
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(name);
  }

  const duplicates = [...byVersion.entries()]
    .filter(([, names]) => names.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1));

  for (const [version, names] of duplicates) {
    errors.push(
      `Versión duplicada ${version}: ${[...names].sort().join(', ')}. `
      + 'El historial de Supabase registra una sola fila por versión, así que '
      + 'una de estas migraciones quedaría sin aplicarse para siempre.',
    );
  }

  return {
    ok: errors.length === 0,
    errors: errors.sort(),
    total: filenames.length,
    versions: [...byVersion.keys()].sort(),
  };
}

/** Ejecución CLI. Devuelve el código de salida (0 = OK). */
export function runValidateMigrationFilesCli({ dir = MIGRATIONS_DIR, log = console } = {}) {
  let filenames;
  try {
    filenames = listMigrationFilenames(dir);
  } catch (error) {
    log.error(`No se pudo leer el directorio de migraciones (${dir}): ${error.message}`);
    return 1;
  }

  const result = validateMigrationFilenames(filenames);

  log.log('=== NugaCore · validación de nombres de migración (hermética) ===');
  log.log(`directorio: ${dir}`);
  log.log(`archivos: ${result.total}`);
  log.log(`versiones únicas: ${result.versions.length}`);

  if (result.ok) {
    log.log('resultado: OK — nombres válidos y versiones únicas.');
    return 0;
  }

  log.error(`resultado: FALLO — ${result.errors.length} incumplimiento(s):`);
  for (const error of result.errors) log.error(`  - ${error}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runValidateMigrationFilesCli());
}
