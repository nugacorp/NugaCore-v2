#!/usr/bin/env node
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
  chk(asBool(process.env.PRODUCTION_RESTORE_TESTED) || asBool(process.env.STAGING_RESTORE_TESTED), 'Restore probado');
  chk(!asBool(process.env.VITE_ENABLE_QUICK_LOGIN) || process.env.NODE_ENV !== 'production', 'Quick login off en prod');
  chk(!process.env.PORTAL_STAGING_TOKEN || process.env.NODE_ENV !== 'production', 'Sin PORTAL_STAGING_TOKEN en prod');

  console.log(lines.join('\n'));
  console.log(`\nResumen local: ${pass} ok, ${fail} fail`);
  return fail === 0 ? 0 : 1;
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
