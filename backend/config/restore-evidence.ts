import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';

const isTrue = (value: string | undefined) => value?.trim().toLowerCase() === 'true';
const isHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isBackupId = (value: unknown) => typeof value === 'string' && /^\d{8}T\d{6}Z$/.test(value);
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const authentic = (evidence: Record<string, unknown>, key: string): boolean => {
  if (typeof evidence.hmac !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.hmac)) return false;
  const body = { ...evidence };
  delete body.hmac;
  const expected = createHmac('sha256', key).update(canonicalJson(body)).digest('hex');
  return timingSafeEqual(Buffer.from(evidence.hmac, 'hex'), Buffer.from(expected, 'hex'));
};

export const productionRestoreEvidenceVerified = (): boolean => {
  if (!isTrue(process.env.PRODUCTION_RESTORE_TESTED)) return false;
  const path = (process.env.PRODUCTION_RESTORE_EVIDENCE_FILE || '').trim();
  const keyPath = (process.env.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE || '').trim();
  if (!path || !keyPath) return false;
  try {
    const evidence = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const key = readFileSync(keyPath, 'utf8').trim();
    const flags = [
      'sourceTargetDistinct', 'completeMarkerVerified', 'manifestVerified', 'databaseRestored',
      'storageRestored', 'rolesVerified', 'coolifyVerified', 'controlPlaneVerified',
      'routerOsLabRollbackVerified',
    ];
    return evidence.version === 1
      && evidence.kind === 'RESTORE_EVIDENCE'
      && authentic(evidence, key)
      && evidence.status === 'verified'
      && isBackupId(evidence.backupId)
      && isHash(evidence.sourceProjectRefHash)
      && isHash(evidence.targetProjectRefHash)
      && evidence.sourceProjectRefHash !== evidence.targetProjectRefHash
      && flags.every((field) => evidence[field] === true)
      && typeof evidence.rpoHours === 'number' && evidence.rpoHours > 0
      && typeof evidence.rtoHours === 'number' && evidence.rtoHours > 0;
  } catch {
    return false;
  }
};
