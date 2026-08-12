#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { validateRestoreEvidence, formatMissingFields, validateSecretFileMetadata } from './lib/gl02-backup-config.mjs';

const path = (process.env.PRODUCTION_RESTORE_EVIDENCE_FILE || '').trim();
let evidence;
let key;
try {
  if (!path) throw new Error('missing');
  evidence = JSON.parse(readFileSync(path, 'utf8'));
  const keyPath = (process.env.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE || '').trim();
  if (!keyPath || (process.platform === 'linux' && validateSecretFileMetadata(statSync(keyPath)).length)) throw new Error('key');
  key = readFileSync(keyPath, 'utf8').trim();
} catch {
  console.error(formatMissingFields('production-restore-evidence', ['PRODUCTION_RESTORE_EVIDENCE_AND_KEY_FILES_VALID']));
  process.exit(1);
}
const result = validateRestoreEvidence(evidence, key);
if (process.env.PRODUCTION_RESTORE_TESTED !== 'true') result.missing.unshift('PRODUCTION_RESTORE_TESTED_TRUE');
if (result.missing.length) {
  console.error(formatMissingFields('production-restore-evidence', result.missing));
  process.exit(1);
}
console.log(JSON.stringify({ scope: 'production-restore-evidence', status: 'verified', backupId: evidence.backupId }));
