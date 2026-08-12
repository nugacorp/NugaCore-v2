#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { validateRestoreEvidence, validateSecretFileMetadata } from './lib/gl02-backup-config.mjs';
// ====================================================================
// Validación local de gates de producción real.
//
// Uso:
//   node scripts/validate-production-readiness.mjs
//   APP_URL=https://prod... AUTH_BEARER=<jwt> node scripts/validate-production-readiness.mjs
//
// Sin APP_URL: evalúa variables de entorno locales.
// Con APP_URL: consulta /api/system/production-readiness en el servidor.
// ====================================================================

const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
const bearer = (process.env.AUTH_BEARER || '').trim();

const criticalFlags = [
  'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
  'USE_DB_INVENTORY', 'USE_DB_SUPPORT', 'USE_DB_SUSPENSION',
];

const asBool = (v) => (v || 'false').trim().toLowerCase() === 'true';
const isStrictLocal = () =>
  asBool(process.env.PRODUCTION_READINESS_STRICT)
  || process.env.NODE_ENV === 'production'
  || asBool(process.env.PUBLIC_DEPLOYMENT);

function checkLocal() {
  let pass = 0;
  let fail = 0;
  const lines = [];

  const chk = (ok, label) => {
    if (ok) { pass++; lines.push(`  ✅  ${label}`); }
    else { fail++; lines.push(`  ❌  ${label}`); }
  };

  console.log('\n=== Production Readiness — validación local ===\n');

  chk(Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), 'Supabase configurado');
  for (const flag of criticalFlags) {
    chk(asBool(process.env[flag]), `${flag}=true`);
  }
  chk(!asBool(process.env.AUTH_TRUST_HEADERS), 'AUTH_TRUST_HEADERS=false');
  chk(asBool(process.env.NODE_ENV === 'production') || asBool(process.env.PUBLIC_DEPLOYMENT), 'Runtime endurecido');
  chk(Boolean(process.env.MIKROTIK_CREDENTIALS_KEY) || !asBool(process.env.PUBLIC_DEPLOYMENT), 'MIKROTIK_CREDENTIALS_KEY (si público)');
  chk(!asBool(process.env.MIKROTIK_WORKER_LIVE), 'MIKROTIK_WORKER_LIVE=false');
  chk(!asBool(process.env.USE_DB_MIKROTIK), 'USE_DB_MIKROTIK=false');
  const restoreEvidenceOk = (() => {
    try {
      const evidencePath = process.env.PRODUCTION_RESTORE_EVIDENCE_FILE || '';
      const keyPath = process.env.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE || '';
      if (process.platform === 'linux' && validateSecretFileMetadata(statSync(keyPath)).length) throw new Error('key metadata');
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
      const key = readFileSync(keyPath, 'utf8').trim();
      return asBool(process.env.PRODUCTION_RESTORE_TESTED)
        && validateRestoreEvidence(evidence, key).ok;
    } catch { return false; }
  })();
  chk(restoreEvidenceOk, 'Restore productivo con evidencia HMAC (staging no aplica)');
  chk(!asBool(process.env.VITE_ENABLE_QUICK_LOGIN) || process.env.NODE_ENV !== 'production', 'Quick login off en prod');
  chk(!process.env.PORTAL_STAGING_TOKEN || process.env.NODE_ENV !== 'production', 'Sin PORTAL_STAGING_TOKEN en prod');

  console.log(lines.join('\n'));
  console.log(`\nResumen local: ${pass} ok, ${fail} fail`);
  if (fail === 0) return 0;
  if (!isStrictLocal()) {
    console.log(
      '\nModo local no estricto: NO APROBADA para produccion, ' +
        'pero los blockers quedan como gates externos no bloqueantes del entorno local.',
    );
    console.log('Para gate productivo usa PRODUCTION_READINESS_STRICT=true o NODE_ENV=production.');
    return 0;
  }
  return 1;
}

async function checkRemote() {
  console.log(`\n=== Production Readiness — ${appUrl} ===\n`);
  if (!bearer) {
    console.log('  ⚠️  Sin AUTH_BEARER — /api/system/production-readiness requiere JWT');
    return 2;
  }

  const res = await fetch(`${appUrl}/api/system/production-readiness`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });

  if (!res.ok) {
    console.log(`  ❌  HTTP ${res.status}`);
    return 1;
  }

  const body = await res.json();
  console.log(`  readyForProduction: ${body.readyForProduction}`);
  console.log(`  blockers: ${(body.blockers || []).join(', ') || '(ninguno)'}`);
  console.log(`  warnings: ${(body.warnings || []).join(', ') || '(ninguno)'}`);

  for (const gate of body.gates || []) {
    const icon = gate.passed ? '✅' : (gate.severity === 'blocker' ? '❌' : '⚠️');
    console.log(`  ${icon}  [${gate.severity}] ${gate.id}: ${gate.detail}`);
  }

  return body.readyForProduction ? 0 : 1;
}

const code = appUrl ? await checkRemote() : checkLocal();
process.exit(code);
