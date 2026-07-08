#!/usr/bin/env node
/* global AbortController */
// ====================================================================
// CHR Smoke Test — valida la conexión READ-ONLY al MikroTik CHR real.
//
// CORRE EN TU MÁQUINA (no en CI): necesita alcance de red al CHR.
// 100% lecturas GET vía REST API de RouterOS v7. NO ejecuta escrituras,
// NO toca configuración, NO requiere MIKROTIK_WORKER_LIVE.
//
// Uso:
//   node scripts/chr-smoke.mjs
//
// Lee del .env (o del entorno):
//   ROUTEROS_HOST                     IP/hostname del CHR (obligatorio)
//   ROUTEROS_PORT                     default 443 (www-ssl)
//   ROUTEROS_USERNAME                 usuario del grupo read-only
//   ROUTEROS_PASSWORD                 password de ese usuario
//   ROUTEROS_TLS_REJECT_UNAUTHORIZED  'false' para cert self-signed (default lab)
//   ROUTEROS_TIMEOUT_MS               default 4000
// ====================================================================

import { readFileSync, existsSync } from 'node:fs';
import { Agent } from 'node:https';

// ── Carga .env mínima (sin dependencia de dotenv) ────────────────────
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const HOST = process.env.ROUTEROS_HOST || '';
const PORT = Number(process.env.ROUTEROS_PORT || 443);
const USER = process.env.ROUTEROS_USERNAME || '';
const PASS = process.env.ROUTEROS_PASSWORD || '';
const TIMEOUT = Number(process.env.ROUTEROS_TIMEOUT_MS || 4000);
const REJECT_TLS = (process.env.ROUTEROS_TLS_REJECT_UNAUTHORIZED || 'false') === 'true';

if (!HOST || !USER || !PASS) {
  console.error('✖ Faltan variables: ROUTEROS_HOST, ROUTEROS_USERNAME y/o ROUTEROS_PASSWORD.');
  console.error('  Configúralas en .env (ver docs/CHR_CONEXION_REAL_RUNBOOK.md §3).');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const agent = new Agent({ rejectUnauthorized: REJECT_TLS });

// Solo endpoints de LECTURA. Nunca POST/PUT/DELETE aquí.
const READ_CHECKS = [
  ['identity', '/rest/system/identity'],
  ['resource', '/rest/system/resource'],
  ['interfaces', '/rest/interface'],
  ['ip-addresses', '/rest/ip/address'],
  ['routerboard/health (opcional)', '/rest/system/health'],
];

const get = async (path) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`https://${HOST}:${PORT}${path}`, {
      headers: { Authorization: auth },
      signal: ctrl.signal,
      // @ts-expect-error dispatcher según versión de Node; agent para https
      agent,
    });
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

console.log(`\nCHR Smoke Test → https://${HOST}:${PORT} (usuario: ${USER}, TLS estricto: ${REJECT_TLS})\n`);

let failures = 0;
for (const [label, path] of READ_CHECKS) {
  const optional = label.includes('opcional');
  try {
    const { status, body } = await get(path);
    if (status === 200) {
      const summary = Array.isArray(body)
        ? `${body.length} elementos`
        : JSON.stringify(body).slice(0, 80);
      console.log(`  ✔ ${label.padEnd(28)} 200 — ${summary}`);
    } else if (status === 401) {
      console.log(`  ✖ ${label.padEnd(28)} 401 — credenciales inválidas o usuario sin política 'rest-api'/'read'`);
      failures++;
    } else {
      console.log(`  ${optional ? '·' : '✖'} ${label.padEnd(28)} HTTP ${status}`);
      if (!optional) failures++;
    }
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timeout ${TIMEOUT}ms` : err.cause?.code || err.message;
    console.log(`  ${optional ? '·' : '✖'} ${label.padEnd(28)} ${reason}`);
    if (!optional) failures++;
  }
}

console.log('');
if (failures === 0) {
  console.log('✔ CHR alcanzable en modo READ-ONLY. Siguiente paso: runbook §4 (conectar NugaCore).');
  process.exit(0);
}
console.log(`✖ ${failures} check(s) fallaron. Revisa docs/CHR_CONEXION_REAL_RUNBOOK.md §5 (troubleshooting).`);
process.exit(1);
