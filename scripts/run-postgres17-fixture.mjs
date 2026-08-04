#!/usr/bin/env node
// ====================================================================
// Ejecuta el fixture de PostgreSQL 17 del webhook durablemente idempotente
// (T5) contra un contenedor DESECHABLE, en local y en CI con el mismo
// comando:
//
//   npm run test:db:postgres17
//
// Por qué existe: `npm test` es hermético y sobre esta migración sólo puede
// afirmar presencia de texto (regex sobre el SQL). Los invariantes que de
// verdad importan —privilegios mínimos de service_role, el UPDATE que exige
// `SELECT … FOR UPDATE`, el arbiter del ON CONFLICT y el winner único bajo
// carrera real— sólo se pueden observar en un PostgreSQL de verdad. Sin este
// gate, retirar un GRANT o reordenar los locks pasa CI en verde.
//
// Secuencia:
//   1. Contenedor efímero postgres:17 (sin publicar puertos, nombre único).
//   2. bootstrap.sql: schema mínimo tipo Supabase; service_role arranca SIN
//      ningún privilegio de tabla y el propio bootstrap lo verifica.
//   3. La migración T5, aplicada DOS veces: debe ser idempotente.
//   4. El fixture: grants, capability, contrato y carreras reales vía dblink.
//
// El contenedor se elimina siempre, incluso ante fallo o Ctrl-C.
// ====================================================================

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IMAGE = process.env.PG17_IMAGE ?? 'postgres:17';
const CONTAINER = `nugacore-t5-pg17-${process.pid}`;
const DB = 't5';
const READY_TIMEOUT_MS = 120_000;

const MIGRATION = 'supabase/migrations/20260730150000_webhook_durable_idempotency.sql';
const BOOTSTRAP = 'tests/db/webhook-durable-idempotency-postgres17-bootstrap.sql';
const FIXTURE = 'tests/db/webhook-durable-idempotency-postgres17.sql';

function run(command, args, { capture = false } = {}) {
  return spawnSync(command, args, {
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
}

function docker(args, options) {
  return run('docker', args, options);
}

function fail(message) {
  console.error(`\n[postgres17] ${message}`);
  process.exitCode = 1;
}

function removeContainer() {
  docker(['rm', '-f', CONTAINER], { capture: true });
}

// psql corre DENTRO del contenedor: así el fixture usa el socket local, que es
// lo que necesita dblink (`dbname=` sin host) para abrir sus dos conexiones
// concurrentes, y no hace falta psql instalado en la máquina anfitriona.
function psqlFile(containerPath) {
  return docker([
    'exec',
    CONTAINER,
    'psql',
    '-X',
    '-q',
    '--username=postgres',
    `--dbname=${DB}`,
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    containerPath,
  ]);
}

function step(label, result) {
  if (result.status === 0) {
    console.log(`[postgres17] OK  · ${label}`);
    return true;
  }
  fail(`FALLO · ${label} (exit ${result.status})`);
  return false;
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = docker(['exec', CONTAINER, 'pg_isready', '--username=postgres', '--quiet'], {
      capture: true,
    });
    if (probe.status === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function main() {
  for (const file of [MIGRATION, BOOTSTRAP, FIXTURE]) {
    if (!existsSync(path.join(repoRoot, file))) {
      fail(`no se encontró ${file}`);
      return;
    }
  }

  if (docker(['version', '--format', '{{.Server.Version}}'], { capture: true }).status !== 0) {
    fail(
      'Docker no está disponible o el daemon no está corriendo. ' +
        'Este gate necesita un PostgreSQL 17 real; arranca Docker y reintenta.',
    );
    return;
  }

  // POSTGRES_HOST_AUTH_METHOD=trust habilita las conexiones locales de dblink
  // sin credenciales. Es aceptable porque el contenedor no publica ningún
  // puerto: no es alcanzable fuera de su propia red.
  const started = docker([
    'run',
    '--rm',
    '--detach',
    '--name',
    CONTAINER,
    '--env',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    '--env',
    `POSTGRES_DB=${DB}`,
    IMAGE,
  ], { capture: true });

  if (started.status !== 0) {
    fail(`no se pudo arrancar ${IMAGE}: ${started.stderr?.trim()}`);
    return;
  }

  try {
    if (!(await waitForReady())) {
      fail('el contenedor no aceptó conexiones dentro del tiempo límite');
      return;
    }
    console.log(`[postgres17] contenedor ${CONTAINER} listo (${IMAGE})`);

    for (const file of [BOOTSTRAP, MIGRATION, FIXTURE]) {
      const copied = docker(
        ['cp', path.join(repoRoot, file), `${CONTAINER}:/tmp/${path.basename(file)}`],
        { capture: true },
      );
      if (copied.status !== 0) {
        fail(`no se pudo copiar ${file}: ${copied.stderr?.trim()}`);
        return;
      }
    }

    const steps = [
      ['bootstrap (service_role sin privilegios)', `/tmp/${path.basename(BOOTSTRAP)}`],
      ['migración T5 · 1ª aplicación', `/tmp/${path.basename(MIGRATION)}`],
      ['migración T5 · 2ª aplicación (idempotencia)', `/tmp/${path.basename(MIGRATION)}`],
      ['fixture: grants, capability, contrato y carreras', `/tmp/${path.basename(FIXTURE)}`],
    ];

    for (const [label, containerPath] of steps) {
      if (!step(label, psqlFile(containerPath))) return;
    }

    console.log('\n[postgres17] TODOS LOS GATES PASARON contra PostgreSQL 17 real.');
  } finally {
    removeContainer();
    console.log(`[postgres17] contenedor ${CONTAINER} eliminado`);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    removeContainer();
    process.exit(1);
  });
}

await main();
