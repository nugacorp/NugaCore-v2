#!/usr/bin/env node
/**
 * Auditoría staging — RBAC + readiness + flags (sin imprimir secretos).
 * Ejecutar DENTRO del contenedor staging con env ya cargado, o vía:
 *   set -a; . /root/nugacore-staging-secrets.env; set +a
 *   node scripts/staging-production-audit.mjs
 */
const base = (process.env.APP_URL || 'https://nugacore-staging.5.180.151.109.sslip.io').replace(/\/$/, '');
const supa = process.env.SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.ANON;
const pw = process.env.STAGING_AUTH_PASSWORD;

if (!supa || !anon || !pw) {
  console.error('Faltan SUPABASE_URL, anon key o STAGING_AUTH_PASSWORD');
  process.exit(2);
}

const USERS = [
  ['Super Admin', 'superadmin@staging.nugacore.local'],
  ['Administrador', 'admin@staging.nugacore.local'],
  ['Cobranza', 'billing@staging.nugacore.local'],
  ['Tecnico', 'tech@staging.nugacore.local'],
  ['Soporte', 'support@staging.nugacore.local'],
  ['Solo lectura', 'readonly@staging.nugacore.local'],
];

const ENDPOINTS = [
  { name: 'clients', path: '/api/clients' },
  { name: 'billing/invoices', path: '/api/billing/invoices' },
  { name: 'finance/cfdi', path: '/api/finance/cfdi/status' },
  { name: 'mikrotik/routers', path: '/api/mikrotik/routers' },
  { name: 'wireguard/servers', path: '/api/wireguard/servers' },
  { name: 'inventory', path: '/api/inventory' },
  { name: 'tickets', path: '/api/tickets' },
];

async function login(email) {
  const r = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  const j = await r.json();
  return j.access_token;
}

async function status(token, path) {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return r.status;
}

const ENV_KEYS = [
  'NODE_ENV', 'PUBLIC_DEPLOYMENT', 'AUTH_TRUST_HEADERS', 'STAGING_RESTORE_TESTED',
  'PRODUCTION_RESTORE_TESTED', 'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING',
  'USE_DB_PAYMENTS', 'USE_DB_SUSPENSION', 'USE_DB_INVENTORY', 'USE_DB_SUPPORT',
  'USE_DB_MIKROTIK', 'USE_DB_WIREGUARD', 'USE_DB_ROUTER_ENROLLMENT',
  'MIKROTIK_WORKER_LIVE', 'MIKROTIK_WORKER_COMMIT', 'VITE_ENABLE_QUICK_LOGIN',
  'SEED_DEMO_DATA', 'CORS_ALLOWED_ORIGINS', 'WEBHOOK_SECRET_MANUAL',
];

const out = { rbac: [], readiness: null, health: null, consistency: null, env: {} };

for (const k of ENV_KEYS) {
  const v = process.env[k];
  if (v === undefined) out.env[k] = null;
  else if (/SECRET|KEY|TOKEN|PASSWORD/i.test(k)) out.env[k] = '(set)';
  else out.env[k] = v;
}

const tokens = [];
for (const [role, email] of USERS) {
  const t = await login(email);
  if (!t) throw new Error(`login failed: ${role}`);
  tokens.push({ role, t });
}

for (const ep of ENDPOINTS) {
  const row = { endpoint: ep.name, path: ep.path, statuses: {} };
  for (const { role, t } of tokens) {
    row.statuses[role] = await status(t, ep.path);
  }
  out.rbac.push(row);
}

const sa = tokens[0].t;
out.health = await (await fetch(`${base}/api/health`, { headers: { Authorization: `Bearer ${sa}` } })).json();
out.readiness = await (await fetch(`${base}/api/system/production-readiness`, { headers: { Authorization: `Bearer ${sa}` } })).json();
out.consistency = await (await fetch(`${base}/api/system/data-consistency`, { headers: { Authorization: `Bearer ${sa}` } })).json();

console.log(JSON.stringify(out, null, 2));
