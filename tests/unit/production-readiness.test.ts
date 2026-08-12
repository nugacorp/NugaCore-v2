import { writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const evidencePath = join(tmpdir(), `nugacore-gl02-evidence-${process.pid}.json`);
const evidenceKeyPath = join(tmpdir(), `nugacore-gl02-evidence-key-${process.pid}`);
const evidenceKey = '0123456789abcdef0123456789abcdef';
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const evidenceBody = {
  version: 1, kind: 'RESTORE_EVIDENCE', status: 'verified', backupId: '20260809T220000Z',
  sourceProjectRefHash: 'a'.repeat(64), targetProjectRefHash: 'b'.repeat(64),
  sourceTargetDistinct: true, completeMarkerVerified: true, manifestVerified: true,
  databaseRestored: true, storageRestored: true, rolesVerified: true, coolifyVerified: true,
  controlPlaneVerified: true, routerOsLabRollbackVerified: true, rpoHours: 24, rtoHours: 4,
};
const validEvidence = {
  ...evidenceBody,
  hmac: createHmac('sha256', evidenceKey).update(canonicalJson(evidenceBody)).digest('hex'),
};

describe('production-readiness', () => {
  const touched = [
    'STAGING_RESTORE_TESTED', 'PRODUCTION_RESTORE_TESTED',
    'PRODUCTION_RESTORE_EVIDENCE_FILE', 'PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AUTH_TRUST_HEADERS',
    'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
    'USE_DB_SUSPENSION', 'USE_DB_INVENTORY', 'USE_DB_SUPPORT',
  ];
  beforeEach(() => {
    vi.resetModules();
    delete process.env.STAGING_RESTORE_TESTED;
    delete process.env.PRODUCTION_RESTORE_TESTED;
    delete process.env.PRODUCTION_RESTORE_EVIDENCE_FILE;
    delete process.env.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE;
    for (const key of [
      'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
      'USE_DB_SUSPENSION', 'USE_DB_INVENTORY', 'USE_DB_SUPPORT',
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of touched) delete process.env[key];
  });

  it('reports blockers when persistence incomplete', async () => {
    const { productionReadinessSnapshot } = await import('../../backend/config/production-readiness');
    const snap = productionReadinessSnapshot();
    expect(snap.readyForLiveWisp).toBe(false);
    expect(snap.blockers.length).toBeGreaterThan(0);
  });

  it('never accepts the staging flag as production restore evidence', async () => {
    process.env.STAGING_RESTORE_TESTED = 'true';
    process.env.PRODUCTION_RESTORE_TESTED = 'false';
    const { productionReadinessSnapshot } = await import('../../backend/config/production-readiness');
    expect(productionReadinessSnapshot().restoreTested).toBe(false);
  });

  it('ready when critical flags and full production evidence are verified', async () => {
    for (const key of [
      'USE_DB_CUSTOMERS', 'USE_DB_PLANS', 'USE_DB_BILLING', 'USE_DB_PAYMENTS',
      'USE_DB_SUSPENSION', 'USE_DB_INVENTORY', 'USE_DB_SUPPORT',
    ]) {
      process.env[key] = 'true';
    }
    writeFileSync(evidencePath, JSON.stringify(validEvidence), { mode: 0o600 });
    writeFileSync(evidenceKeyPath, evidenceKey, { mode: 0o600 });
    process.env.PRODUCTION_RESTORE_TESTED = 'true';
    process.env.PRODUCTION_RESTORE_EVIDENCE_FILE = evidencePath;
    process.env.PRODUCTION_RESTORE_EVIDENCE_HMAC_KEY_FILE = evidenceKeyPath;
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.AUTH_TRUST_HEADERS = 'false';
    const { productionReadinessSnapshot } = await import('../../backend/config/production-readiness');
    const snap = productionReadinessSnapshot();
    expect(snap.blockers).toEqual([]);
    expect(snap.readyForLiveWisp).toBe(true);
  });

  it('CLI keeps local blockers non-blocking but fails in strict mode', () => {
    const env = { ...process.env };
    delete env.PRODUCTION_READINESS_STRICT;
    delete env.PUBLIC_DEPLOYMENT;
    env.NODE_ENV = 'test';
    env.SUPABASE_URL = '';
    env.SUPABASE_SERVICE_ROLE_KEY = '';

    const relaxed = spawnSync(process.execPath, ['scripts/validate-production-readiness.mjs'], { env });
    expect(relaxed.status).toBe(0);
    expect(relaxed.stdout.toString()).toContain('Modo local no estricto');

    const strict = spawnSync(process.execPath, ['scripts/validate-production-readiness.mjs'], {
      env: { ...env, PRODUCTION_READINESS_STRICT: 'true' },
    });
    expect(strict.status).toBe(1);
  });
});
