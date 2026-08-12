// ====================================================================
// Arnés de PostgreSQL HERMÉTICO para pruebas de esquema/migración.
//
// Levanta un cluster EFÍMERO propio (initdb + postgres en un puerto alto
// de loopback, autenticación trust, datadir en un temp que se borra al
// final). No toca Supabase, no usa credenciales y no sale a la red.
//
// Por qué existe: las constraints de integridad (FKs compuestas por
// tenant) solo se pueden PROBAR ejecutándolas contra un Postgres real.
// Un scan estático del .sql demuestra que el texto está escrito, no que
// Postgres rechace un cruce A→B. Ver MT-05.
//
// Opt-in explícito con RUN_PG_LOCAL_TESTS=true (igual que RUN_DB_TESTS).
// Sin el flag las suites que lo usan se OMITEN, de modo que `npm test`
// sigue siendo 100% hermético y sin dependencias de binarios locales.
// ====================================================================

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IS_WINDOWS = process.platform === 'win32';
const EXE = IS_WINDOWS ? '.exe' : '';

export interface PgResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface PgSession {
  processId: number | undefined;
  exited: Promise<number | null>;
  stop(): void;
}

export interface HermeticPg {
  port: number;
  binDir: string;
  dataDir: string;
  /** Ejecuta SQL literal. No lanza: devuelve el código de salida. */
  run(sql: string, db?: string): PgResult;
  /** Ejecuta un archivo .sql. No lanza. */
  runFile(file: string, db?: string): PgResult;
  /** Abre una conexión psql persistente para pruebas de concurrencia/locks. */
  startSession(sql: string, db?: string): PgSession;
  /** Ejecuta SQL y lanza si falla. Devuelve stdout recortado. */
  exec(sql: string, db?: string): string;
  /** Ejecuta SQL de una sola columna/fila y devuelve el valor como texto. */
  scalar(sql: string, db?: string): string;
  createDb(name: string): void;
  dropDb(name: string): void;
  stop(): void;
}

/**
 * Localiza el directorio bin de PostgreSQL. `PG_BIN_DIR` tiene prioridad.
 * Devuelve null si no hay binarios utilizables.
 */
export function findPgBinDir(): string | null {
  const candidates: string[] = [];

  const explicit = process.env.PG_BIN_DIR;
  if (explicit) candidates.push(explicit);

  if (IS_WINDOWS) {
    const root = 'C:\\Program Files\\PostgreSQL';
    if (existsSync(root)) {
      // Versión más alta primero.
      for (const version of readdirSync(root).sort().reverse()) {
        candidates.push(join(root, version, 'bin'));
      }
    }
  } else {
    const root = '/usr/lib/postgresql';
    if (existsSync(root)) {
      for (const version of readdirSync(root).sort().reverse()) {
        candidates.push(join(root, version, 'bin'));
      }
    }
    candidates.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin');
  }

  for (const dir of candidates) {
    if (existsSync(join(dir, `initdb${EXE}`)) && existsSync(join(dir, `postgres${EXE}`))) {
      return dir;
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const randomPort = () => 49152 + Math.floor(Math.random() * 15000);

/**
 * Arranca un cluster efímero. Lanza si no hay binarios: el llamador debe
 * comprobar `findPgBinDir()` y omitir la suite explícitamente.
 */
export async function startHermeticPg(): Promise<HermeticPg> {
  const binDir = findPgBinDir();
  if (!binDir) {
    throw new Error(
      'No se encontraron binarios de PostgreSQL (initdb/postgres). ' +
        'Instala PostgreSQL o define PG_BIN_DIR.',
    );
  }

  const root = mkdtempSync(join(tmpdir(), 'nugacore-pg-'));
  const dataDir = join(root, 'data');

  // --no-locale: mensajes del servidor en inglés y estables, sin depender
  // del locale de la máquina (las aserciones comparan textos de error).
  const init = spawnSync(
    join(binDir, `initdb${EXE}`),
    ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'],
    { encoding: 'utf8' },
  );
  if (init.status !== 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`initdb falló:\n${init.stdout ?? ''}\n${init.stderr ?? ''}`);
  }

  let port = 0;
  let server: ReturnType<typeof spawn> | null = null;

  for (let attempt = 0; attempt < 8 && !port; attempt += 1) {
    const candidate = randomPort();
    const child = spawn(
      join(binDir, `postgres${EXE}`),
      [
        '-D', dataDir,
        '-p', String(candidate),
        '-c', 'listen_addresses=127.0.0.1',
        '-c', 'unix_socket_directories=',
        // Cluster desechable: durabilidad innecesaria, arranque más rápido.
        '-c', 'fsync=off',
        '-c', 'full_page_writes=off',
        '-c', 'synchronous_commit=off',
      ],
      { stdio: 'ignore', detached: false },
    );
    child.unref();

    // Espera activa a que acepte conexiones.
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      await sleep(250);
      if (child.exitCode !== null) break; // murió (puerto ocupado, etc.)
      const probe = spawnSync(
        join(binDir, `pg_isready${EXE}`),
        ['-h', '127.0.0.1', '-p', String(candidate), '-U', 'postgres'],
        { encoding: 'utf8' },
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
    }

    if (ready) {
      port = candidate;
      server = child;
    } else {
      try {
        child.kill();
      } catch {
        /* ya murió */
      }
    }
  }

  if (!port || !server) {
    rmSync(root, { recursive: true, force: true });
    throw new Error('No se pudo arrancar el cluster efímero de PostgreSQL.');
  }

  const psqlPath = join(binDir, `psql${EXE}`);
  const psqlEnv = { ...process.env, PGCLIENTENCODING: 'UTF8' };

  const invoke = (args: string[], db: string): PgResult => {
    const res = spawnSync(
      psqlPath,
      ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args],
      { encoding: 'utf8', env: psqlEnv, maxBuffer: 32 * 1024 * 1024 },
    );
    return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  };

  const pg: HermeticPg = {
    port,
    binDir,
    dataDir,

    run: (sql, db = 'postgres') => invoke(['-c', sql], db),

    runFile: (file, db = 'postgres') => invoke(['-f', file], db),

    startSession(sql, db = 'postgres') {
      const child = spawn(
        psqlPath,
        [
          '-h', '127.0.0.1',
          '-p', String(port),
          '-U', 'postgres',
          '-d', db,
          '-X',
          '-q',
          '-v', 'ON_ERROR_STOP=1',
          '-c', sql,
        ],
        { stdio: 'ignore', env: psqlEnv },
      );
      const exited = new Promise<number | null>((resolve) => {
        child.once('exit', (code) => resolve(code));
      });
      return {
        processId: child.pid,
        exited,
        stop() {
          if (child.exitCode === null) child.kill();
        },
      };
    },

    exec(sql, db = 'postgres') {
      const res = invoke(['-c', sql], db);
      if (res.code !== 0) {
        throw new Error(`SQL falló (exit ${res.code}):\n${sql}\n--- stderr ---\n${res.stderr}`);
      }
      return res.stdout.trim();
    },

    scalar(sql, db = 'postgres') {
      const res = invoke(['-tA', '-c', sql], db);
      if (res.code !== 0) {
        throw new Error(`SQL falló (exit ${res.code}):\n${sql}\n--- stderr ---\n${res.stderr}`);
      }
      return res.stdout.trim();
    },

    createDb(name) {
      const res = invoke(['-c', `CREATE DATABASE "${name}"`], 'postgres');
      if (res.code !== 0) throw new Error(`CREATE DATABASE ${name} falló:\n${res.stderr}`);
    },

    dropDb(name) {
      invoke(['-c', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`], 'postgres');
    },

    stop() {
      spawnSync(join(binDir, `pg_ctl${EXE}`), ['-D', dataDir, '-m', 'immediate', '-w', 'stop'], {
        encoding: 'utf8',
        timeout: 20000,
      });
      try {
        server?.kill();
      } catch {
        /* ya detenido */
      }
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };

  return pg;
}
