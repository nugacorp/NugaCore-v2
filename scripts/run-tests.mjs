#!/usr/bin/env node
// ====================================================================
// Runner de las suites de prueba que dependen de servicios REALES.
//
// Activa el opt-in correspondiente (RUN_DB_TESTS / RUN_AUTH_TESTS) de forma
// MULTIPLATAFORMA (Windows/macOS/Linux) sin depender de `cross-env`, y lanza
// Vitest solo contra el archivo de esa suite con un timeout de red holgado.
//
//   node scripts/run-tests.mjs db          -> npm run test:db
//   node scripts/run-tests.mjs db:billing  -> npm run test:db:billing
//   node scripts/run-tests.mjs auth        -> npm run test:auth
//
// La separación garantiza que `npm test` (default) NUNCA toque la red:
// estas suites se OMITEN sin su flag. Ver docs/TESTING_STRATEGY.md.
//
// `db`         = gate GLOBAL de DB (todos los dominios con persistencia real).
//                Puede fallar por dominios pendientes NO relacionados con Billing
//                (p.ej. router-enrollment / inventory).
// `db:billing` = gate ENFOCADO de la Billing & Collections Foundation: solo las
//                suites DB de Billing + Customers + Plans (de las que depende
//                billing) más las suites herméticas de billing. NO incluye
//                router-enrollment, inventory, routeros, mikrotik ni wireguard.
// ====================================================================

import { spawnSync } from 'node:child_process';

const MODES = {
  db: {
    flag: 'RUN_DB_TESTS',
    file: 'tests/contract/customers.db.contract.test.ts tests/contract/plans.db.contract.test.ts tests/contract/billing.schema.db.test.ts tests/contract/billing.db.contract.test.ts tests/contract/router-enrollment.db.contract.test.ts tests/contract/inventory.db.contract.test.ts tests/contract/wireguard-ipam.db.contract.test.ts',
    timeoutMs: 30000,
  },
  'db:billing': {
    flag: 'RUN_DB_TESTS',
    // Solo suites DB de la Billing Foundation + sus dependencias (customers,
    // plans). Diseñadas para Supabase real (USE_DB_*=true en staging) y se
    // auto-omiten sin RUN_DB_TESTS + credenciales. NO se incluyen las suites
    // herméticas de billing (esas viven en `npm test`, que asume store-mode +
    // AUTH_TRUST_HEADERS) ni dominios ajenos (router-enrollment, inventory,
    // routeros, mikrotik, wireguard).
    file: [
      'tests/contract/billing.schema.db.test.ts',
      'tests/contract/billing.db.contract.test.ts',
      'tests/contract/customers.db.contract.test.ts',
      'tests/contract/plans.db.contract.test.ts',
    ].join(' '),
    timeoutMs: 30000,
  },
  auth: {
    flag: 'RUN_AUTH_TESTS',
    file: 'tests/contract/auth.db.contract.test.ts',
    timeoutMs: 120000,
  },
};

const mode = process.argv[2];
const cfg = MODES[mode];

if (!cfg) {
  console.error('Uso: node scripts/run-tests.mjs <db|auth>');
  process.exit(1);
}

const env = { ...process.env, [cfg.flag]: 'true' };
const command = `npx vitest run ${cfg.file} --testTimeout=${cfg.timeoutMs}`;

const result = spawnSync(command, {
  stdio: 'inherit',
  env,
  shell: true,
});

process.exit(result.status ?? 1);
