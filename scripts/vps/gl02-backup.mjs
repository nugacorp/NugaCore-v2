#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expiredBackupIds, isBackupId, verifySignedMarker } from '../lib/gl02-backup-config.mjs';
import {
  assertOffHostDns, assertOwnership, loadRuntime, remoteBase, removeTemp, rcloneEnv, run,
  sha256File, signComplete, tempDir, writeJson,
} from '../lib/gl02-runtime.mjs';

const mode = process.argv[2] || '--dry-run';
if (!['--dry-run', '--execute'].includes(mode)) process.exit(2);
if (process.platform !== 'linux' || (process.getuid?.() !== 0 && process.env.GL02_TEST_MODE !== '1')) process.exit(1);

try {
  const runtime = loadRuntime();
  await assertOffHostDns(runtime);
  assertOwnership(runtime);
  if (mode === '--dry-run') {
    console.log(JSON.stringify({ scope: 'gl02-backup', status: 'dry-run-ready', ownershipVerified: true }));
    process.exit(0);
  }

  const backupId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  if (!isBackupId(backupId)) throw new Error('BACKUP_ID_CANONICAL');
  const work = tempDir('backup');
  try {
    const curlConfig = join(work, 'curl.config');
    const attestation = join(work, 'source-project.json');
    writeFileSync(curlConfig, [
      'fail', 'silent', 'show-error',
      `url = "https://api.supabase.com/v1/projects/${runtime.env.get('SUPABASE_PROJECT_REF')}"`,
      `header = "Authorization: Bearer ${runtime.env.get('SUPABASE_ACCESS_TOKEN')}"`,
      `output = "${attestation}"`,
    ].join('\n'), { mode: 0o600 });
    run('curl', ['--config', curlConfig]);
    const project = JSON.parse(readFileSync(attestation, 'utf8'));
    if (String(project.id || project.ref || '').toLowerCase() !== runtime.env.get('SUPABASE_PROJECT_REF')) throw new Error('SUPABASE_MANAGEMENT_PROJECT_IDENTITY');
    rmSync(attestation, { force: true });
    const managedBackups = join(work, 'managed-backups.json');
    writeFileSync(curlConfig, [
      'fail', 'silent', 'show-error',
      `url = "https://api.supabase.com/v1/projects/${runtime.env.get('SUPABASE_PROJECT_REF')}/database/backups"`,
      `header = "Authorization: Bearer ${runtime.env.get('SUPABASE_ACCESS_TOKEN')}"`,
      `output = "${managedBackups}"`,
    ].join('\n'), { mode: 0o600 });
    run('curl', ['--config', curlConfig]);
    const managed = JSON.parse(readFileSync(managedBackups, 'utf8'));
    const managedCount = Array.isArray(managed) ? managed.length : (managed.backups || managed.data || []).length;
    if (!Number.isInteger(managedCount) || managedCount < 1) throw new Error('SUPABASE_MANAGED_BACKUP_AVAILABLE');
    rmSync(managedBackups, { force: true });

    const pgService = join(work, 'pg_service.conf');
    writeFileSync(pgService, `[nugacore-production]\nconninfo=${runtime.env.get('PRODUCTION_DB_URL')}\n`, { mode: 0o600 });
    const pgEnv = { ...process.env, PGSERVICEFILE: pgService };
    run('pg_dump', ['--dbname=nugacore-production', '--format=custom', '--no-owner', '--no-privileges', `--file=${join(work, 'database.dump')}`], { env: pgEnv });
    run('pg_dumpall', ['--dbname=nugacore-production', '--roles-only', '--no-role-passwords', `--file=${join(work, 'roles.sql')}`], { env: pgEnv });
    const coolify = run('docker', ['exec', 'coolify-db', 'sh', '-ceu', 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" --format=custom --no-owner --no-privileges']);
    writeFileSync(join(work, 'coolify.dump'), coolify, { mode: 0o600 });
    run('tar', ['-C', '/', '-czf', join(work, 'infrastructure.tar.gz'), 'etc/wireguard', 'data/coolify/source', 'data/coolify/proxy', 'data/coolify/ssh']);

    for (const name of ['database.dump', 'roles.sql', 'coolify.dump', 'infrastructure.tar.gz']) {
      run('gpg', ['--batch', '--quiet', '--trust-model', 'always', '--recipient', runtime.env.get('BACKUP_GPG_RECIPIENT'), '--encrypt', '--output', join(work, `${name}.gpg`), join(work, name)]);
      rmSync(join(work, name), { force: true });
    }
    const storageListing = run('rclone', ['lsf', 'supabase_storage:', '--recursive', '--hash'], { env: rcloneEnv(runtime) });
    writeFileSync(join(work, 'storage.manifest'), storageListing, { mode: 0o600 });
    const artifacts = ['database.dump.gpg', 'roles.sql.gpg', 'coolify.dump.gpg', 'infrastructure.tar.gz.gpg', 'storage.manifest'];
    const manifest = {
      version: 1, backupId, namespaceId: runtime.env.get('BACKUP_NAMESPACE_ID'),
      sourceProjectRefHash: createHash('sha256').update(runtime.env.get('SUPABASE_PROJECT_REF')).digest('hex'),
      managedBackupAvailable: true,
      artifacts: Object.fromEntries(artifacts.map((name) => [name, sha256File(join(work, name))])),
      requirements: { database: true, storage: true, roles: true, coolify: true, controlPlane: true },
    };
    writeJson(join(work, 'manifest.json'), manifest);

    const destination = `${remoteBase(runtime.env, backupId)}/control-plane`;
    run('rclone', ['copy', work, destination, '--immutable'], { env: rcloneEnv(runtime) });
    run('rclone', ['copy', 'supabase_storage:', `${remoteBase(runtime.env, backupId)}/storage`, '--immutable'], { env: rcloneEnv(runtime) });
    run('rclone', ['cryptcheck', work, destination], { env: rcloneEnv(runtime) });
    run('rclone', ['check', 'supabase_storage:', `${remoteBase(runtime.env, backupId)}/storage`, '--download', '--one-way'], { env: rcloneEnv(runtime) });
    const downloadedManifest = run('rclone', ['cat', `${destination}/manifest.json`], { env: rcloneEnv(runtime) });
    if (createHash('sha256').update(downloadedManifest).digest('hex') !== sha256File(join(work, 'manifest.json'))) throw new Error('MANIFEST_DOWNLOAD_VERIFIED');
    const complete = signComplete(runtime, backupId, sha256File(join(work, 'manifest.json')));
    writeJson(join(work, 'COMPLETE.json'), complete);
    run('rclone', ['copyto', join(work, 'COMPLETE.json'), `${remoteBase(runtime.env, backupId)}/COMPLETE.json`, '--immutable'], { env: rcloneEnv(runtime) });

    const listing = run('rclone', ['lsf', remoteBase(runtime.env), '--dirs-only', '--max-depth', '1'], { env: rcloneEnv(runtime) });
    for (const expired of expiredBackupIds(listing.split(/\r?\n/).map((x) => x.replace(/\/$/, '')), Number(runtime.env.get('BACKUP_RETENTION_DAYS')))) {
      const raw = run('rclone', ['cat', `${remoteBase(runtime.env, expired)}/COMPLETE.json`], { env: rcloneEnv(runtime) });
      let marker;
      try { marker = JSON.parse(raw); } catch { throw new Error(`RETENTION_${expired}_MARKER_JSON`); }
      if (!verifySignedMarker(marker, runtime.key) || marker.kind !== 'COMPLETE' || marker.backupId !== expired || marker.namespaceId !== runtime.env.get('BACKUP_NAMESPACE_ID')) throw new Error(`RETENTION_${expired}_MARKER_VALID`);
      run('rclone', ['purge', remoteBase(runtime.env, expired)], { env: rcloneEnv(runtime) });
    }
    console.log(JSON.stringify({ scope: 'gl02-backup', status: 'verified', backupId, completeMarkerWritten: true, retentionStatus: 'verified' }));
  } finally { removeTemp(work, 'backup'); }
} catch (error) {
  console.error(JSON.stringify({ scope: 'gl02-backup', status: 'blocked', check: String(error.message || error).split(',')[0] }));
  process.exit(1);
}
