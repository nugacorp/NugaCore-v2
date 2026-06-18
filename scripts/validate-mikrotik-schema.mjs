#!/usr/bin/env node
// ====================================================================
// DB-1 · Validación del esquema canónico de `mikrotik_routers` en Supabase.
//
// Solo corre si RUN_DB_TESTS=true + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Sin esas variables imprime instrucciones y sale con código 0.
//
// Verifica, vía Supabase REST (sin SQL directo):
//   1. Tabla `mikrotik_routers` existe/expuesta.
//   2. Columnas del modelo canónico (monitoreo + provisioning) seleccionables.
//   3. Tablas auxiliares de provisioning existen.
//
// Diseño: docs/MIKROTIK_ROUTERS_SCHEMA_RECONCILIATION.md
//
// NUNCA imprime secretos: solo nombres de columnas y estados OK/FAIL.
// NO activa USE_DB_MIKROTIK ni toca routers reales.
//
// Uso:
//   node scripts/validate-mikrotik-schema.mjs
//   RUN_DB_TESTS=true node scripts/validate-mikrotik-schema.mjs
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const optIn = process.env.RUN_DB_TESTS === 'true';
const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hasCredentials = supabaseUrl.trim() !== '' && serviceRoleKey.trim() !== '';

if (!optIn) {
  console.log('Validación de esquema MikroTik omitida (RUN_DB_TESTS != true).');
  console.log('Para correr: RUN_DB_TESTS=true node scripts/validate-mikrotik-schema.mjs');
  process.exit(0);
}

if (!hasCredentials) {
  console.error('Error: RUN_DB_TESTS=true requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let passed = 0;
let failed = 0;
const ok = (msg) => { console.log(`  ✅  ${msg}`); passed++; };
const fail = (msg, detail) => { console.error(`  ❌  ${msg}${detail ? ': ' + detail : ''}`); failed++; };

const TABLE = 'mikrotik_routers';

// Modelo canónico (debe coincidir con CANONICAL_MIKROTIK_ROUTER_COLUMNS en
// backend/domains/mikrotik/provisioning/types.ts).
const CANONICAL_COLUMNS = [
  'id', 'name', 'created_at', 'updated_at',
  'connection_type', 'management_ip', 'ip_address', 'vpn_ip',
  'api_port', 'api_ssl_port', 'username', 'encrypted_password', 'has_credentials',
  'provisioning_status', 'status', 'is_online',
  'cpu_usage_pct', 'memory_usage_pct', 'routeros_version',
  'last_health_check_at', 'last_seen_at',
  'linked_tower_id', 'notes',
];

const AUX_TABLES = [
  'mikrotik_router_credentials',
  'mikrotik_provisioning_tokens',
  'mikrotik_provisioning_scripts',
  'mikrotik_command_audit',
];

async function checkTable(tableName) {
  const { error } = await client.from(tableName).select('*').limit(0);
  if (error) { fail(`tabla ${tableName}`, error.message); return false; }
  ok(`tabla ${tableName}`);
  return true;
}

async function checkColumn(tableName, columnName) {
  const { error } = await client.from(tableName).select(columnName).limit(0);
  if (error) { fail(`${tableName}.${columnName}`, error.message); return false; }
  ok(`${tableName}.${columnName}`);
  return true;
}

console.log('\n── NugaCore · Validación esquema canónico mikrotik_routers (DB-1) ──\n');

console.log('1. Tabla:');
const tableOk = await checkTable(TABLE);

if (tableOk) {
  console.log('\n2. Columnas canónicas (monitoreo + provisioning):');
  for (const col of CANONICAL_COLUMNS) await checkColumn(TABLE, col);
}

console.log('\n3. Tablas auxiliares de provisioning:');
for (const t of AUX_TABLES) await checkColumn(t, 'id');

console.log(`\n── Resultado: ${passed} OK · ${failed} fallidos ──\n`);

if (failed > 0) {
  console.error(
    'Esquema incompleto. Aplicar (en orden) y refrescar el schema cache:\n' +
    '  supabase/migrations/20260605000000_mikrotik_provisioning_schema.sql\n' +
    '  supabase/migrations/20260618000000_mikrotik_routers_reconciliation.sql\n' +
    "  NOTIFY pgrst, 'reload schema';\n",
  );
  process.exit(1);
}

console.log('Esquema canónico de mikrotik_routers validado correctamente.\n');
process.exit(0);
