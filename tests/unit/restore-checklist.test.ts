import { createHmac } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { validateProductionRestoreEvidenceEnv } from '../../scripts/validate-restore-checklist.mjs';

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

type RestoreStatFn = typeof import('node:fs').statSync;
const linuxKeyStat = (uid: number): RestoreStatFn => (
  (() => ({ uid, mode: 0o100600 })) as unknown as RestoreStatFn
);

describe('production restore evidence CLI', () => {
  const script = resolve('scripts/validate-restore-checklist.mjs');

  it('fails without evidence and never accepts the staging boolean', () => {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env, STAGING_RESTORE_TESTED: 'true' };
    delete cleanEnv.PRODUCTION_RESTORE_TESTED;
    delete cleanEnv.PRODUCTION_RESTORE_EVIDENCE_FILE;
    delete cleanEnv.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE;
    expect(spawnSync(process.execPath, [script], { env: cleanEnv }).status).toBe(1);
  });

  it('accepts only complete HMAC-authenticated production evidence with valid Linux key metadata', () => {
    const key = '0123456789abcdef0123456789abcdef';
    const body = {
      version: 1, kind: 'RESTORE_EVIDENCE', status: 'verified', backupId: '20260809T220000Z',
      sourceProjectRefHash: 'a'.repeat(64), targetProjectRefHash: 'b'.repeat(64),
      sourceTargetDistinct: true, completeMarkerVerified: true, manifestVerified: true,
      databaseRestored: true, storageRestored: true, rolesVerified: true, coolifyVerified: true,
      controlPlaneVerified: true, routerOsLabRollbackVerified: true, rpoHours: 24, rtoHours: 4,
    };
    const evidence = { ...body, hmac: createHmac('sha256', key).update(canonicalJson(body)).digest('hex') };
    const tempDir = mkdtempSync(join(tmpdir(), 'gl02-checklist-'));
    try {
      const evidencePath = join(tempDir, 'evidence.json');
      const keyPath = join(tempDir, 'evidence.key');
      writeFileSync(evidencePath, JSON.stringify(evidence), { mode: 0o600 });
      writeFileSync(keyPath, key, { mode: 0o600 });
      chmodSync(evidencePath, 0o600);
      chmodSync(keyPath, 0o600);
      const env = {
        ...process.env,
        PRODUCTION_RESTORE_TESTED: 'true',
        PRODUCTION_RESTORE_EVIDENCE_FILE: evidencePath,
        PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE: keyPath,
      };

      const result = validateProductionRestoreEvidenceEnv(env, {
        platform: 'linux',
        stat: linuxKeyStat(0),
      });
      expect(result).toEqual({ ok: true, missing: [], evidence });

      const runnerOwnedKey = validateProductionRestoreEvidenceEnv(env, {
        platform: 'linux',
        stat: linuxKeyStat(1001),
      });
      expect(runnerOwnedKey).toEqual({
        ok: false,
        missing: ['PRODUCTION_RESTORE_EVIDENCE_AND_KEY_FILES_VALID'],
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
