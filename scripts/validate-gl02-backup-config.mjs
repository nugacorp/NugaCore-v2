#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';

import {
  formatMissingFields,
  validateProductionBackupConfig,
  validateHostedRestoreConfig,
  validateRouterOsLabConfig,
  validateSecretFileMetadata,
} from './lib/gl02-backup-config.mjs';

const testMode = process.env.GL02_TEST_MODE === '1';
const PRODUCTION_ENV = testMode && process.env.GL02_PRODUCTION_ENV
  ? process.env.GL02_PRODUCTION_ENV : '/root/nugacore-production-backup.env';
const RCLONE_CONFIG = testMode && process.env.GL02_RCLONE_CONFIG
  ? process.env.GL02_RCLONE_CONFIG : '/root/.config/rclone/rclone.conf';
const ROUTEROS_ENV = testMode && process.env.GL02_ROUTEROS_ENV
  ? process.env.GL02_ROUTEROS_ENV : '/root/nugacore-routeros-lab.env';
const scope = process.argv[2] || 'all';

if (!['all', 'production-backup', 'production-restore', 'routeros-lab'].includes(scope)) {
  console.error(formatMissingFields('gl02', ['SCOPE_VALID']));
  process.exit(2);
}

const readRootSecret = (fileLabel, path) => {
  try {
    const stat = statSync(path);
    const missing = validateSecretFileMetadata(stat);
    return { text: readFileSync(path, 'utf8'), missing };
  } catch {
    return { text: '', missing: [`${fileLabel}_FILE_PRESENT`] };
  }
};

let missing = [];
if (process.platform !== 'linux' || (typeof process.getuid === 'function' && process.getuid() !== 0 && !testMode)) {
  missing.push('RUNTIME_LINUX_ROOT');
}

if (scope === 'all' || scope === 'production-backup') {
  const production = readRootSecret('PRODUCTION_BACKUP_ENV', PRODUCTION_ENV);
  const rclone = readRootSecret('RCLONE_CONFIG', RCLONE_CONFIG);
  missing.push(...production.missing, ...rclone.missing);
  missing.push(...validateProductionBackupConfig(production.text, rclone.text).missing);
}

if (scope === 'all' || scope === 'production-restore') {
  const production = readRootSecret('PRODUCTION_BACKUP_ENV', PRODUCTION_ENV);
  missing.push(...production.missing);
  missing.push(...validateHostedRestoreConfig(production.text).missing);
}

if (scope === 'all' || scope === 'routeros-lab') {
  const routeros = readRootSecret('ROUTEROS_LAB_ENV', ROUTEROS_ENV);
  missing.push(...routeros.missing);
  missing.push(...validateRouterOsLabConfig(routeros.text).missing);
}

missing = [...new Set(missing)];
if (missing.length > 0) {
  console.error(formatMissingFields(scope, missing));
  process.exit(1);
}

console.log(`${scope}: READY`);
