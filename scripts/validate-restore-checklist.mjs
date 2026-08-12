#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateRestoreEvidence, formatMissingFields, validateSecretFileMetadata } from './lib/gl02-backup-config.mjs';

const invalidEvidenceFiles = ['PRODUCTION_RESTORE_EVIDENCE_AND_KEY_FILES_VALID'];

export const validateProductionRestoreEvidenceEnv = (
  env = process.env,
  { platform = process.platform, readFile = readFileSync, stat = statSync } = {},
) => {
  const evidencePath = (env.PRODUCTION_RESTORE_EVIDENCE_FILE || '').trim();
  let evidence;
  let key;
  try {
    if (!evidencePath) throw new Error('missing');
    evidence = JSON.parse(readFile(evidencePath, 'utf8'));
    const keyPath = (env.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE || '').trim();
    if (!keyPath) throw new Error('key');
    const metadataIssues = platform === 'linux' ? validateSecretFileMetadata(stat(keyPath)) : [];
    if (metadataIssues.length) throw new Error('key metadata');
    key = readFile(keyPath, 'utf8').trim();
  } catch {
    return { ok: false, missing: invalidEvidenceFiles };
  }

  const result = validateRestoreEvidence(evidence, key);
  const missing = [...result.missing];
  if (env.PRODUCTION_RESTORE_TESTED !== 'true') missing.unshift('PRODUCTION_RESTORE_TESTED_TRUE');
  return { ok: missing.length === 0, missing, evidence };
};

export const runValidateRestoreChecklistCli = ({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) => {
  const result = validateProductionRestoreEvidenceEnv(env);
  if (!result.ok) {
    stderr.write(`${formatMissingFields('production-restore-evidence', result.missing)}\n`);
    return 1;
  }
  stdout.write(JSON.stringify({
    scope: 'production-restore-evidence',
    status: 'verified',
    backupId: result.evidence.backupId,
  }));
  stdout.write('\n');
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runValidateRestoreChecklistCli());
}
