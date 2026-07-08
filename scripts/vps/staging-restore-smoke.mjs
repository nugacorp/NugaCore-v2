#!/usr/bin/env node
// ====================================================================
// Restore smoke — OLA 0 §14 (automatizable).
//
// Verifica que Supabase responde, tablas críticas existen, y la API staging
// está healthy. Si todo pasa, recomienda activar STAGING_RESTORE_TESTED=true.
//
// Uso (en VPS o CI con credenciales):
//   source /root/nugacore-staging-secrets.env
//   STAGING_URL=https://nugacore-staging... node scripts/vps/staging-restore-smoke.mjs
//   STAGING_RESTORE_TESTED=true node scripts/validate-restore-checklist.mjs
// ====================================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const stagingUrl = (process.env.STAGING_URL || 'https://nugacore-staging.5.180.151.109.sslip.io').replace(/\/$/, '');

const tables = ['clients', 'invoices', 'payment_promises', 'portal_user_bindings'];
let ok = 0;
let fail = 0;

console.log('\n=== Restore Smoke — OLA 0 §14 ===\n');

if (!supabaseUrl || !serviceRoleKey) {
  console.log('  ❌  Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const table of tables) {
  const { error, count } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    console.log(`  ❌  ${table}: ${error.message}`);
    fail++;
  } else {
    console.log(`  ✅  ${table} (${count ?? 0} rows)`);
    ok++;
  }
}

try {
  const healthRes = await fetch(`${stagingUrl}/api/health`);
  if (healthRes.ok) {
    console.log(`  ✅  GET ${stagingUrl}/api/health`);
    ok++;
  } else {
    console.log(`  ❌  health ${healthRes.status}`);
    fail++;
  }
} catch (err) {
  console.log(`  ⚠️  health unreachable: ${err instanceof Error ? err.message : String(err)}`);
  fail++;
}

console.log(`\nResumen: ${ok} ok, ${fail} fail`);

if (fail === 0) {
  console.log('\n✅ Smoke OK — marcar en Coolify: STAGING_RESTORE_TESTED=true');
  console.log('   Luego: node scripts/validate-restore-checklist.mjs');
  process.exit(0);
}

console.log('\n⚠️  Corregir fallos antes de marcar STAGING_RESTORE_TESTED=true');
process.exit(1);
