#!/usr/bin/env node
// ====================================================================
// Ejecuta los fixtures de PostgreSQL 17 contra contenedores DESECHABLES,
// en local y en CI con el mismo comando:
//
//   npm run test:db:postgres17            → todos los casos
//   npm run test:db:postgres17 -- webhook → sólo uno
//
// Por qué existe: `npm test` es hermético y sobre el SQL sólo puede afirmar
// presencia de texto (regex). Los invariantes que de verdad importan
// —privilegios mínimos de service_role, locks, arbiters del ON CONFLICT,
// acciones referenciales de las claves foráneas— sólo se pueden observar en
// un PostgreSQL de verdad. Sin este gate, retirar un GRANT, reordenar los
// locks o cambiar un ON DELETE pasa CI en verde.
//
// Secuencia por caso:
//   1. Contenedor efímero postgres:17 (sin publicar puertos, nombre único).
//   2. bootstrap.sql: schema mínimo tipo Supabase; service_role arranca SIN
//      ningún privilegio de tabla sobre los destinos y el propio bootstrap
//      lo verifica.
//   3. Cada migración del caso, aplicada DOS veces: debe ser idempotente.
//   4. El fixture: los asserts propios del caso.
//
// El contenedor se elimina siempre, incluso ante fallo o Ctrl-C.
// ====================================================================

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IMAGE = process.env.PG17_IMAGE ?? 'postgres:17';
const READY_TIMEOUT_MS = 120_000;

// El PID solo NO basta: el sistema los reutiliza, y con ejecuciones seguidas
// `docker run --name` choca con el contenedor de la anterior y el gate sale 1
// sin dejar rastro útil. Es el mismo defecto que el repo ya arregló en `uid()`.
const RUN_ID = `${process.pid}-${randomBytes(4).toString('hex')}`;

// ── Casos ───────────────────────────────────────────────────────────
// Añadir un caso es añadir una entrada aquí: nada más del runner cambia.
//
//   db         nombre de la base dentro del contenedor
//   migrations migraciones reales a aplicar, en orden, cada una DOS veces
//              (lista vacía = el caso sólo verifica lo que monta el bootstrap)
//   bootstrap  schema mínimo previo a las migraciones
//   fixture    los asserts del caso
const CASES = {
  webhook: {
    label: 'Webhook durablemente idempotente',
    db: 't5',
    migrations: ['supabase/migrations/20260730150000_webhook_durable_idempotency.sql'],
    bootstrap: 'tests/db/webhook-durable-idempotency-postgres17-bootstrap.sql',
    fixture: 'tests/db/webhook-durable-idempotency-postgres17.sql',
    fixtureLabel: 'fixture: grants, capability, contrato y carreras',
  },
  'customer-delete': {
    label: 'Borrado de clientes · grafo referencial y RPC transaccional',
    db: 'custdel',
    migrations: ['supabase/migrations/20260806120000_customers_delete_cascade.sql'],
    bootstrap: 'tests/db/customer-delete-postgres17-bootstrap.sql',
    fixture: 'tests/db/customer-delete-postgres17.sql',
    fixtureLabel: 'fixture: grafo de FK y comportamiento del borrado',
  },
};

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

function removeContainer(container) {
  docker(['rm', '-f', container], { capture: true });
}

// psql corre DENTRO del contenedor: así el fixture usa el socket local, que es
// lo que necesita dblink (`dbname=` sin host) para abrir sus dos conexiones
// concurrentes, y no hace falta psql instalado en la máquina anfitriona.
function psqlFile(container, db, containerPath) {
  return docker([
    'exec',
    container,
    'psql',
    '-X',
    '-q',
    '--username=postgres',
    `--dbname=${db}`,
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

// La imagen de postgres arranca un servidor TEMPORAL para correr initdb y los
// scripts de inicio, lo apaga y levanta el definitivo. Durante ese relevo el
// socket desaparece, así que una sola sonda afortunada no significa nada: el
// primer psql se estrella con "No such file or directory". Se exige que la
// sonda —una consulta real contra la base del caso, no `pg_isready`— acierte
// varias veces seguidas; el corte del relevo pone el contador a cero.
const READY_STREAK = 3;

async function waitForReady(container, db) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let streak = 0;
  while (Date.now() < deadline) {
    const probe = docker(
      ['exec', container, 'psql', '-X', '-q', '-t', '--username=postgres', `--dbname=${db}`,
       '-c', 'SELECT 1'],
      { capture: true },
    );
    streak = probe.status === 0 ? streak + 1 : 0;
    if (streak >= READY_STREAK) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Los pasos del caso, en orden. Cada migración va dos veces a propósito: la
// segunda pasada es la que demuestra que el DDL es idempotente.
function buildSteps(testCase) {
  const steps = [['bootstrap (service_role sin privilegios)', testCase.bootstrap]];
  for (const migration of testCase.migrations) {
    const name = path.basename(migration);
    steps.push([`migración ${name} · 1ª aplicación`, migration]);
    steps.push([`migración ${name} · 2ª aplicación (idempotencia)`, migration]);
  }
  steps.push([testCase.fixtureLabel, testCase.fixture]);
  return steps;
}

async function runCase(name, testCase) {
  console.log(`\n[postgres17] ── caso ${name}: ${testCase.label} ──`);

  const files = [testCase.bootstrap, testCase.fixture, ...testCase.migrations];
  for (const file of files) {
    if (!existsSync(path.join(repoRoot, file))) {
      fail(`no se encontró ${file}`);
      return false;
    }
  }

  const container = `nugacore-${name}-pg17-${RUN_ID}`;

  // POSTGRES_HOST_AUTH_METHOD=trust habilita las conexiones locales de dblink
  // sin credenciales. Es aceptable porque el contenedor no publica ningún
  // puerto: no es alcanzable fuera de su propia red.
  const started = docker(
    [
      'run',
      '--rm',
      '--detach',
      '--name',
      container,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '--env',
      `POSTGRES_DB=${testCase.db}`,
      IMAGE,
    ],
    { capture: true },
  );

  if (started.status !== 0) {
    fail(`no se pudo arrancar ${IMAGE}: ${started.stderr?.trim()}`);
    return false;
  }

  try {
    if (!(await waitForReady(container, testCase.db))) {
      fail('el contenedor no aceptó conexiones dentro del tiempo límite');
      return false;
    }
    console.log(`[postgres17] contenedor ${container} listo (${IMAGE})`);

    // Copiar una sola vez cada fichero, aunque el paso se ejecute dos veces.
    for (const file of new Set(files)) {
      const copied = docker(
        ['cp', path.join(repoRoot, file), `${container}:/tmp/${path.basename(file)}`],
        { capture: true },
      );
      if (copied.status !== 0) {
        fail(`no se pudo copiar ${file}: ${copied.stderr?.trim()}`);
        return false;
      }
    }

    for (const [label, file] of buildSteps(testCase)) {
      if (!step(label, psqlFile(container, testCase.db, `/tmp/${path.basename(file)}`))) {
        return false;
      }
    }

    return true;
  } finally {
    removeContainer(container);
    console.log(`[postgres17] contenedor ${container} eliminado`);
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((name) => !(name in CASES));
  if (unknown.length > 0) {
    fail(
      `caso desconocido: ${unknown.join(', ')}. Disponibles: ${Object.keys(CASES).join(', ')}`,
    );
    return;
  }
  const names = requested.length > 0 ? requested : Object.keys(CASES);

  if (docker(['version', '--format', '{{.Server.Version}}'], { capture: true }).status !== 0) {
    fail(
      'Docker no está disponible o el daemon no está corriendo. ' +
        'Este gate necesita un PostgreSQL 17 real; arranca Docker y reintenta.',
    );
    return;
  }

  for (const name of names) {
    if (!(await runCase(name, CASES[name]))) return;
  }

  console.log(
    `\n[postgres17] TODOS LOS GATES PASARON contra PostgreSQL 17 real (${names.join(', ')}).`,
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const name of Object.keys(CASES)) removeContainer(`nugacore-${name}-pg17-${RUN_ID}`);
    process.exit(1);
  });
}

await main();
