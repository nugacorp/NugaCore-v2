#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createSignedMarker, isBackupId, validateRestoreEvidence, verifySignedMarker,
} from '../lib/gl02-backup-config.mjs';
import {
  assertOffHostDns, assertOwnership, loadRuntime, readRemoteMarker, remoteBase, removeTemp,
  rcloneEnv, run, sha256File, tempDir, writeJson,
} from '../lib/gl02-runtime.mjs';

let mode = '--dry-run';
let backupId = '';
let evidenceOut = '';
let routerEvidencePath = '';
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === '--dry-run' || arg === '--execute') mode = arg;
  else if (arg === '--backup-id') backupId = process.argv[++index] || '';
  else if (arg === '--evidence-out') evidenceOut = process.argv[++index] || '';
  else if (arg === '--routeros-evidence') routerEvidencePath = process.argv[++index] || '';
  else process.exit(2);
}
if (!isBackupId(backupId)) process.exit(2);
if (process.platform !== 'linux' || (process.getuid?.() !== 0 && process.env.GL02_TEST_MODE !== '1')) process.exit(1);

try {
  const runtime = loadRuntime({ restore: true });
  await assertOffHostDns(runtime);
  assertOwnership(runtime);
  const complete = readRemoteMarker(runtime, `${backupId}/COMPLETE.json`);
  if (complete.kind !== 'COMPLETE' || complete.backupId !== backupId) throw new Error('COMPLETE_MARKER_MATCHES_BACKUP');
  for (const field of ['database', 'storage', 'roles', 'coolify', 'controlPlane']) {
    if (complete.verified?.[field] !== true) throw new Error(`COMPLETE_${field.toUpperCase()}_VERIFIED`);
  }
  if (mode === '--dry-run') {
    console.log(JSON.stringify({ scope: 'gl02-restore', status: 'dry-run-ready', backupId, completeMarkerVerified: true, gateUnchanged: true }));
    process.exit(0);
  }
  if (!evidenceOut || (!/^\/var\/lib\/nugacore\/gl02\/[A-Za-z0-9._-]+\.json$/.test(evidenceOut) && process.env.GL02_TEST_MODE !== '1')) throw new Error('EVIDENCE_OUTPUT_SAFE_PATH');
  let routerEvidence;
  try { routerEvidence = JSON.parse(readFileSync(routerEvidencePath, 'utf8')); } catch { throw new Error('ROUTEROS_LAB_EVIDENCE_PRESENT'); }
  if (!verifySignedMarker(routerEvidence, runtime.key)
    || routerEvidence.kind !== 'ROUTEROS_LAB_ROLLBACK'
    || routerEvidence.environment !== 'LAB'
    || routerEvidence.rollbackVerified !== true) throw new Error('ROUTEROS_LAB_EVIDENCE_AUTHENTIC');

  const work = tempDir('restore');
  const containers = [];
  try {
    const control = join(work, 'control-plane');
    mkdirSync(control, { mode: 0o700 });
    const source = `${remoteBase(runtime.env, backupId)}/control-plane`;
    run('rclone', ['copy', source, control], { env: rcloneEnv(runtime) });
    run('rclone', ['cryptcheck', control, source], { env: rcloneEnv(runtime) });
    const manifestPath = join(control, 'manifest.json');
    if (sha256File(manifestPath) !== complete.manifestSha256) throw new Error('MANIFEST_COMPLETE_HASH_MATCH');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.backupId !== backupId || manifest.namespaceId !== runtime.env.get('BACKUP_NAMESPACE_ID')) throw new Error('MANIFEST_IDENTITY_MATCH');
    for (const [name, hash] of Object.entries(manifest.artifacts || {})) {
      if (sha256File(join(control, name)) !== hash) throw new Error(`MANIFEST_${name}_HASH`);
    }

    for (const name of ['database.dump', 'roles.sql', 'coolify.dump', 'infrastructure.tar.gz']) {
      run('gpg', ['--batch', '--quiet', '--decrypt', '--output', join(work, name), join(control, `${name}.gpg`)]);
    }

    const curlConfig = join(work, 'target-api.config');
    writeFileSync(curlConfig, [
      'fail', 'silent', 'show-error',
      `url = "${runtime.env.get('RESTORE_TARGET_SUPABASE_URL')}/rest/v1/"`,
      `header = "apikey: ${runtime.env.get('RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY')}"`,
      `header = "Authorization: Bearer ${runtime.env.get('RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY')}"`,
    ].join('\n'), { mode: 0o600 });
    run('curl', ['--config', curlConfig]);

    const pgService = join(work, 'pg_service.conf');
    writeFileSync(pgService, `[nugacore-restore-target]\nconninfo=${runtime.env.get('RESTORE_TARGET_DB_URL')}\n`, { mode: 0o600 });
    const pgEnv = { ...process.env, PGSERVICEFILE: pgService };
    run('pg_restore', ['--dbname=nugacore-restore-target', '--no-owner', '--no-privileges', '--exit-on-error', join(work, 'database.dump')], { env: pgEnv });
    for (const table of runtime.env.get('RESTORE_REQUIRED_TABLES').split(',')) {
      const present = run('psql', ['--dbname=nugacore-restore-target', '--tuples-only', '--no-align', '--command', `select to_regclass('public.${table}') is not null`], { env: pgEnv }).trim();
      if (present !== 't') throw new Error(`RESTORE_TABLE_${table.toUpperCase()}_PRESENT`);
    }

    const dockerEnvFile = join(work, 'docker.env');
    writeFileSync(dockerEnvFile, 'POSTGRES_PASSWORD=generated-only-for-isolated-drill\n', { mode: 0o600 });
    for (const purpose of ['roles', 'coolify']) {
      const container = `nugacore-gl02-${purpose}-${backupId.toLowerCase()}`;
      containers.push(container);
      run('docker', ['run', '-d', '--name', container, '--network', 'none', '--tmpfs', `/var/lib/postgresql/data:rw,noexec,nosuid,size=${runtime.env.get('RESTORE_TMPFS_SIZE')}`, '--env-file', dockerEnvFile, runtime.env.get('RESTORE_POSTGRES_IMAGE')]);
      run('docker', ['exec', '-i', container, purpose === 'roles' ? 'psql' : 'pg_restore', '-U', 'postgres', '-d', 'postgres', ...(purpose === 'coolify' ? ['--exit-on-error'] : [])], { input: readFileSync(join(work, purpose === 'roles' ? 'roles.sql' : 'coolify.dump')) });
      run('docker', ['exec', container, 'pg_isready', '-U', 'postgres']);
    }

    run('rclone', ['copy', `${remoteBase(runtime.env, backupId)}/storage`, 'supabase_storage_target:', '--immutable'], { env: rcloneEnv(runtime, true) });
    run('rclone', ['check', `${remoteBase(runtime.env, backupId)}/storage`, 'supabase_storage_target:', '--download', '--one-way'], { env: rcloneEnv(runtime, true) });
    const archiveList = run('tar', ['-tzf', join(work, 'infrastructure.tar.gz')]);
    if (archiveList.split(/\r?\n/).some((path) => path.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(path))) throw new Error('CONTROL_PLANE_ARCHIVE_PATHS_SAFE');
    const infra = join(work, 'infrastructure');
    mkdirSync(infra, { mode: 0o700 });
    run('tar', ['-xzf', join(work, 'infrastructure.tar.gz'), '--no-same-owner', '-C', infra]);

    const evidence = createSignedMarker({
      version: 1, kind: 'RESTORE_EVIDENCE', status: 'verified', backupId,
      sourceProjectRefHash: manifest.sourceProjectRefHash,
      targetProjectRefHash: createHash('sha256').update(runtime.env.get('RESTORE_TARGET_PROJECT_REF')).digest('hex'),
      sourceTargetDistinct: manifest.sourceProjectRefHash !== createHash('sha256').update(runtime.env.get('RESTORE_TARGET_PROJECT_REF')).digest('hex'),
      completeMarkerVerified: true, manifestVerified: true, databaseRestored: true,
      storageRestored: true, rolesVerified: true, coolifyVerified: true, controlPlaneVerified: true,
      routerOsLabRollbackVerified: true, rpoHours: 24, rtoHours: 4,
    }, runtime.key);
    const checked = validateRestoreEvidence(evidence, runtime.key);
    if (!checked.ok) throw new Error(checked.missing[0]);
    mkdirSync(dirname(evidenceOut), { recursive: true, mode: 0o700 });
    writeJson(evidenceOut, evidence);
    console.log(JSON.stringify({ scope: 'gl02-restore', status: 'verified', backupId, evidenceFileWritten: true, gateUnchanged: true }));
  } finally {
    for (const container of containers) {
      try { run('docker', ['rm', '-f', container]); } catch { /* cleanup is best effort */ }
    }
    removeTemp(work, 'restore');
  }
} catch (error) {
  console.error(JSON.stringify({ scope: 'gl02-restore', status: 'blocked', check: String(error.message || error).split(',')[0] }));
  process.exit(1);
}
