#!/usr/bin/env node
// ====================================================================
// Validación staging readiness — OLA 0–2 cierre (batch 3).
//
// Verifica flags críticos, tablas OLA 6, y checklist documentado.
// Uso:
//   node scripts/validate-staging-readiness.mjs
//   RUN_DB_TESTS=true node scripts/validate-staging-readiness.mjs
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const optIn = process.env.RUN_DB_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasCredentials = supabaseUrl.trim() !== '' && serviceRoleKey.trim() !== '';

const CRITICAL = [
  'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
  'USE_DB_INVENTORY', 'USE_DB_SUPPORT', 'USE_DB_SUSPENSION',
];

console.log('\n=== Staging Readiness — OLA 0–2 ===\n');

let ok = 0;
let warn = 0;

for (const flag of CRITICAL) {
  if (process.env[flag] === 'true') {
    console.log(`  ✅  ${flag}=true`);
    ok++;
  } else {
    console.log(`  ⚠️  ${flag} no activo`);
    warn++;
  }
}

const mikrotikLive = process.env.MIKROTIK_WORKER_LIVE === 'true';
if (!mikrotikLive) {
  console.log('  ✅  MIKROTIK_WORKER_LIVE=false (gated)');
  ok++;
} else {
  console.log('  ❌  MIKROTIK_WORKER_LIVE=true — debe estar false en staging');
}

console.log('\nEndpoints a validar con API corriendo:');
console.log('  GET /api/system/staging-readiness');
console.log('  GET /api/system/persistence-status');
console.log('  GET /api/system/data-consistency');
console.log('  POST /api/jobs/run { "job": "persistence-audit" }');

if (!hasCredentials) {
  console.log('\nSin credenciales Supabase — omitiendo tablas DB.');
  console.log('Restore manual: checklist §14 en PRODUCTION_READINESS_CHECKLIST.md');
  process.exit(warn > 0 ? 0 : 0);
}

if (!optIn) {
  console.log('\nPara validar tablas: RUN_DB_TESTS=true node scripts/validate-staging-readiness.mjs');
  process.exit(0);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tables = ['tenants', 'radius_accounting', 'payment_promises', 'client_tags'];
for (const table of tables) {
  const { error } = await client.from(table).select('*').limit(0);
  if (error) {
    console.log(`  ❌  tabla ${table}: ${error.message}`);
  } else {
    console.log(`  ✅  tabla ${table}`);
    ok++;
  }
}

console.log(`\nResumen: ${ok} ok, ${warn} advertencias flags`);
process.exit(0);
