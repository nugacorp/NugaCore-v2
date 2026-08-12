import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createSignedMarker, parseStrictEnvDocument, validateProductionBackupConfig,
  validateHostedRestoreConfig, validateSecretFileMetadata, verifySignedMarker,
} from './gl02-backup-config.mjs';

export const paths = () => ({
  env: process.env.GL02_TEST_MODE === '1' && process.env.GL02_PRODUCTION_ENV
    ? process.env.GL02_PRODUCTION_ENV : '/root/nugacore-production-backup.env',
  rclone: process.env.GL02_TEST_MODE === '1' && process.env.GL02_RCLONE_CONFIG
    ? process.env.GL02_RCLONE_CONFIG : '/root/.config/rclone/rclone.conf',
});

export const loadRuntime = ({ restore = false } = {}) => {
  const selected = paths();
  for (const path of Object.values(selected)) {
    const missing = validateSecretFileMetadata(statSync(path));
    if (missing.length) throw new Error(missing.join(','));
  }
  const envText = readFileSync(selected.env, 'utf8');
  const rcloneText = readFileSync(selected.rclone, 'utf8');
  const validation = restore
    ? validateHostedRestoreConfig(envText)
    : validateProductionBackupConfig(envText, rcloneText);
  if (!validation.ok) throw new Error(validation.missing.join(','));
  const parsed = parseStrictEnvDocument(envText);
  if (parsed.errors.length) throw new Error(parsed.errors.join(','));
  const keyPath = parsed.values.get('BACKUP_MARKER_HMAC_KEY_FILE');
  const keyStat = statSync(keyPath);
  const keyMissing = validateSecretFileMetadata(keyStat);
  if (keyMissing.length) throw new Error(keyMissing.join(','));
  const key = readFileSync(keyPath, 'utf8').trim();
  if (key.length < 32) throw new Error('BACKUP_MARKER_HMAC_KEY_MIN_32');
  return { env: parsed.values, key, envPath: selected.env, rclone: selected.rclone };
};

export const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: options.encoding ?? 'utf8',
    env: options.env || process.env,
    input: options.input,
    stdio: options.stdio,
  });
  if (result.error || result.status !== 0) {
    const code = result.error?.code || result.status;
    throw new Error(`COMMAND_${command.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_FAILED_${code}`);
  }
  return result.stdout || '';
};

export const remoteBase = (env, backupId = '') => {
  const base = `${env.get('BACKUP_RCLONE_REMOTE')}:`;
  return backupId ? `${base}${backupId}` : base;
};

const privateAddress = (address) => {
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || /^fe[89ab]/i.test(address)) return true;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && (parts[0] === 10 || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168));
};

export const assertOffHostDns = async (runtime) => {
  if (process.env.GL02_TEST_MODE === '1') return;
  const host = runtime.env.get('BACKUP_OFFSITE_HOST');
  const resolved = await lookup(host, { all: true, verbatim: true });
  if (!resolved.length || resolved.some(({ address }) => privateAddress(address))) throw new Error('BACKUP_OFFSITE_DNS_PUBLIC');
  const local = new Set(Object.values(networkInterfaces()).flat().filter(Boolean).map((entry) => entry.address));
  if (resolved.some(({ address }) => local.has(address))) throw new Error('BACKUP_OFFSITE_DNS_NOT_ON_HOST');
};

export const rcloneEnv = (runtime, target = false) => ({
  ...process.env,
  RCLONE_CONFIG: runtime.rclone,
  RCLONE_CONFIG_SUPABASE_STORAGE_TYPE: 's3',
  RCLONE_CONFIG_SUPABASE_STORAGE_PROVIDER: 'Other',
  RCLONE_CONFIG_SUPABASE_STORAGE_ENDPOINT: runtime.env.get(target ? 'RESTORE_TARGET_STORAGE_S3_ENDPOINT' : 'SUPABASE_STORAGE_S3_ENDPOINT'),
  RCLONE_CONFIG_SUPABASE_STORAGE_ACCESS_KEY_ID: runtime.env.get(target ? 'RESTORE_TARGET_STORAGE_S3_ACCESS_KEY_ID' : 'SUPABASE_STORAGE_S3_ACCESS_KEY_ID'),
  RCLONE_CONFIG_SUPABASE_STORAGE_SECRET_ACCESS_KEY: runtime.env.get(target ? 'RESTORE_TARGET_STORAGE_S3_SECRET_ACCESS_KEY' : 'SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY'),
});

export const readRemoteMarker = (runtime, object) => {
  const raw = run('rclone', ['cat', `${remoteBase(runtime.env)}${object}`], { env: rcloneEnv(runtime) });
  let marker;
  try { marker = JSON.parse(raw); } catch { throw new Error(`MARKER_${object}_JSON`); }
  if (!verifySignedMarker(marker, runtime.key)) throw new Error(`MARKER_${object}_AUTHENTIC`);
  if (marker.namespaceId !== runtime.env.get('BACKUP_NAMESPACE_ID')) throw new Error(`MARKER_${object}_NAMESPACE`);
  return marker;
};

export const assertOwnership = (runtime) => {
  const marker = readRemoteMarker(runtime, 'OWNERSHIP.json');
  if (marker.kind !== 'OWNERSHIP' || marker.version !== 1) throw new Error('OWNERSHIP_MARKER_VALID');
};

export const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
};
export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const tempDir = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `nugacore-gl02-${label}.`));
  chmodSync(dir, 0o700);
  return dir;
};
export const removeTemp = (dir, label) => {
  const allowed = new RegExp(`^${tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\/]nugacore-gl02-${label}\\.[A-Za-z0-9_-]+$`);
  if (!allowed.test(dir)) throw new Error('TEMP_CLEANUP_GUARD');
  rmSync(dir, { recursive: true, force: true });
};
export const signComplete = (runtime, backupId, manifestSha256) => createSignedMarker({
  version: 1, kind: 'COMPLETE', backupId,
  namespaceId: runtime.env.get('BACKUP_NAMESPACE_ID'), manifestSha256,
  verified: { database: true, storage: true, roles: true, coolify: true, controlPlane: true },
}, runtime.key);
