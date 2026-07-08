#!/usr/bin/env node
// ====================================================================
// Checklist restore staging — OLA 0 (§14).
//
// Uso:
//   STAGING_RESTORE_TESTED=true node scripts/validate-restore-checklist.mjs
//   node scripts/vps/staging-restore-smoke.mjs  (smoke previo)
// ====================================================================

console.log('\n=== Restore Checklist — OLA 0 §14 ===\n');

const tested = process.env.STAGING_RESTORE_TESTED === 'true';

if (tested) {
  console.log('  ✅  STAGING_RESTORE_TESTED=true');
  console.log('  Confirmar manualmente: backup tomado, restore ejecutado, API responde.');
  process.exit(0);
}

console.log('  ⚠️  STAGING_RESTORE_TESTED no está en true');
console.log('\nPasos manuales (PRODUCTION_READINESS_CHECKLIST.md §14):');
console.log('  1. Backup completo de Supabase (schema + data)');
console.log('  2. Restore en entorno de prueba');
console.log('  3. Verificar GET /api/health y persistencia-status');
console.log('  4. Exportar STAGING_RESTORE_TESTED=true en staging\n');
process.exit(0);
