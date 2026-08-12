import { describe, expect, it } from 'vitest';

import {
  createSignedMarker,
  expiredBackupIds,
  formatMissingFields,
  isBackupId,
  isSafeRestoreTempPath,
  parseStrictEnvDocument,
  validateSecretFileMetadata,
  validateProductionBackupConfig,
  validateHostedRestoreConfig,
  validateRestoreEvidence,
  validateRouterOsLabConfig,
  verifySignedMarker,
} from '../../scripts/lib/gl02-backup-config.mjs';

const SOURCE_REF = 'abcdefghijklmnopqrst';
const TARGET_REF = 'qrstabcdefghijklmnop';

const completeProductionEnv = `
PRODUCTION_DB_URL=postgresql://postgres:pw@db.${SOURCE_REF}.supabase.co:5432/postgres
PRODUCTION_SUPABASE_URL=https://${SOURCE_REF}.supabase.co
SUPABASE_PROJECT_REF=${SOURCE_REF}
SUPABASE_ACCESS_TOKEN=management-token
SUPABASE_STORAGE_S3_ENDPOINT=https://${SOURCE_REF}.storage.supabase.co/storage/v1/s3
SUPABASE_STORAGE_S3_ACCESS_KEY_ID=storage-access
SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=storage-secret
BACKUP_RCLONE_REMOTE=offsite-crypt
BACKUP_RCLONE_PATH=nugacore/production
BACKUP_OFFSITE_CONFIRMED=true
BACKUP_OFFSITE_HOST=s3.backup.example.invalid
BACKUP_ON_HOST_IDENTITIES=vps.production.example.invalid,203.0.113.10
BACKUP_OFFSITE_BUCKET=nugacore-backups
BACKUP_NAMESPACE_ID=nugacore-production-0123456789abcdef
BACKUP_MARKER_HMAC_KEY_FILE=/root/nugacore-backup-marker.key
BACKUP_GPG_RECIPIENT=backup@example.invalid
BACKUP_RETENTION_DAYS=30
RESTORE_POSTGRES_IMAGE=supabase/postgres:15.8.1.085@sha256:${'a'.repeat(64)}
RESTORE_TMPFS_SIZE=8g
RESTORE_REQUIRED_TABLES=clients,invoices,payments
`;

const completeRclone = `
[offsite]
type = s3
provider = Other
endpoint = https://s3.backup.example.invalid

[offsite-crypt]
type = crypt
remote = offsite:nugacore-backups/nugacore-production-0123456789abcdef
password = obscured
password2 = obscured
`;

const completeRestoreEnv = `${completeProductionEnv}
RESTORE_TARGET_CONFIRMED_ISOLATED=true
RESTORE_TARGET_PROJECT_REF=${TARGET_REF}
RESTORE_TARGET_DB_URL=postgresql://postgres:pw@db.${TARGET_REF}.supabase.co:5432/postgres
RESTORE_TARGET_SUPABASE_URL=https://${TARGET_REF}.supabase.co
RESTORE_TARGET_SUPABASE_SERVICE_ROLE_KEY=restore-service-role
RESTORE_TARGET_STORAGE_S3_ENDPOINT=https://${TARGET_REF}.storage.supabase.co/storage/v1/s3
RESTORE_TARGET_STORAGE_S3_ACCESS_KEY_ID=restore-access
RESTORE_TARGET_STORAGE_S3_SECRET_ACCESS_KEY=restore-secret
`;

describe('GL-02 fail-closed config validation', () => {
  it('requires root ownership and mode 0600 for every secret scaffold', () => {
    expect(validateSecretFileMetadata({ uid: 0, mode: 0o100600 })).toEqual([]);
    expect(validateSecretFileMetadata({ uid: 1000, mode: 0o100644 })).toEqual([
      'FILE_OWNER_ROOT',
      'FILE_MODE_0600',
    ]);
  });

  it('an empty production scaffold reports names only and never secret values', () => {
    const result = validateProductionBackupConfig(
      'PRODUCTION_DB_URL=super-secret-url\nSUPABASE_ACCESS_TOKEN=\n',
      '',
    );
    const output = formatMissingFields('production-backup', result.missing);

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('SUPABASE_ACCESS_TOKEN');
    expect(result.missing).toContain('BACKUP_RCLONE_REMOTE');
    expect(output).not.toContain('super-secret-url');
    expect(output).not.toContain('=');
  });

  it('rejects unknown, duplicate and shell-bearing dotenv lines', () => {
    const parsed = parseStrictEnvDocument(
      'SUPABASE_ACCESS_TOKEN=one\nSUPABASE_ACCESS_TOKEN=two\nUNKNOWN=x\nPRODUCTION_DB_URL=$(touch /tmp/pwn)\n',
      new Set(['SUPABASE_ACCESS_TOKEN', 'PRODUCTION_DB_URL']),
    );
    expect(parsed.errors).toEqual([
      'ENV_DUPLICATE_SUPABASE_ACCESS_TOKEN',
      'ENV_UNKNOWN_UNKNOWN',
      'ENV_UNSAFE_PRODUCTION_DB_URL',
    ]);
  });

  it('accepts only an encrypted off-host rclone remote and a digest-pinned image', () => {
    expect(validateProductionBackupConfig(completeProductionEnv, completeRclone)).toEqual({
      ok: true,
      missing: [],
    });
  });

  it('rejects local, unencrypted or missing rclone destinations', () => {
    const localConfig = '[offsite-crypt]\ntype = local\nnounc = true\n';
    const plainRemote = completeProductionEnv.replace(
      'BACKUP_RCLONE_REMOTE=offsite-crypt',
      'BACKUP_RCLONE_REMOTE=offsite',
    );

    expect(validateProductionBackupConfig(completeProductionEnv, localConfig).missing).toContain(
      'BACKUP_RCLONE_REMOTE_ENCRYPTED_OFF_HOST',
    );
    expect(validateProductionBackupConfig(plainRemote, completeRclone).missing).toContain(
      'BACKUP_RCLONE_REMOTE_ENCRYPTED_OFF_HOST',
    );
  });

  it('rejects loopback/private backing endpoints and a crypt prefix outside the allowlist', () => {
    const loopback = completeRclone.replace('https://s3.backup.example.invalid', 'http://127.0.0.1:9000');
    const wrongPrefix = completeRclone.replace(
      'remote = offsite:nugacore-backups/nugacore-production-0123456789abcdef',
      'remote = offsite:other',
    );
    expect(validateProductionBackupConfig(completeProductionEnv, loopback).missing).toContain(
      'BACKUP_RCLONE_BACKING_PUBLIC_HTTPS',
    );
    expect(validateProductionBackupConfig(completeProductionEnv, wrongPrefix).missing).toContain(
      'BACKUP_RCLONE_PREFIX_ALLOWLISTED',
    );
    const onHost = completeProductionEnv.replace(
      'BACKUP_ON_HOST_IDENTITIES=vps.production.example.invalid,203.0.113.10',
      'BACKUP_ON_HOST_IDENTITIES=s3.backup.example.invalid,203.0.113.10',
    );
    expect(validateProductionBackupConfig(onHost, completeRclone).missing).toContain(
      'BACKUP_RCLONE_BACKING_NOT_ON_HOST',
    );
  });

  it('requires an explicit off-host confirmation in addition to the rclone type', () => {
    const unconfirmed = completeProductionEnv.replace(
      'BACKUP_OFFSITE_CONFIRMED=true',
      'BACKUP_OFFSITE_CONFIRMED=false',
    );
    expect(validateProductionBackupConfig(unconfirmed, completeRclone).missing).toContain(
      'BACKUP_OFFSITE_CONFIRMED_TRUE',
    );
  });

  it('rejects an image tag that is not pinned by sha256 digest', () => {
    const unpinned = completeProductionEnv.replace(
      /RESTORE_POSTGRES_IMAGE=.*/,
      'RESTORE_POSTGRES_IMAGE=supabase/postgres:latest',
    );

    expect(validateProductionBackupConfig(unpinned, completeRclone).missing).toContain(
      'RESTORE_POSTGRES_IMAGE_PINNED_DIGEST',
    );
  });

  it('rejects an invalid restore tmpfs limit', () => {
    const invalid = completeProductionEnv.replace('RESTORE_TMPFS_SIZE=8g', 'RESTORE_TMPFS_SIZE=all');
    expect(validateProductionBackupConfig(invalid, completeRclone).missing).toContain(
      'RESTORE_TMPFS_SIZE_BOUNDED',
    );
  });

  it('requires explicit LAB confirmation, expected identity and exactly one credential path', () => {
    const result = validateRouterOsLabConfig(`
ROUTEROS_LAB_CONFIRMED=false
ROUTEROS_LAB_HOST=router.invalid
ROUTEROS_LAB_PORT=22
ROUTEROS_LAB_USER=operator
ROUTEROS_LAB_PASSWORD=router-secret
ROUTEROS_LAB_EXPECTED_IDENTITY=
`);
    const output = formatMissingFields('routeros-lab', result.missing);

    expect(result.missing).toEqual([
      'ROUTEROS_LAB_CONFIRMED_TRUE',
      'ROUTEROS_LAB_EXPECTED_IDENTITY',
    ]);
    expect(output).not.toContain('router-secret');
  });

  it('accepts a confirmed LAB with password or key, but not with neither', () => {
    const base = `
ROUTEROS_LAB_CONFIRMED=true
ROUTEROS_LAB_HOST=router.invalid
ROUTEROS_LAB_PORT=22
ROUTEROS_LAB_USER=operator
ROUTEROS_LAB_EXPECTED_IDENTITY=chr-gl02-lab
`;

    expect(validateRouterOsLabConfig(`${base}ROUTEROS_LAB_PASSWORD=secret\n`).ok).toBe(true);
    expect(validateRouterOsLabConfig(`${base}ROUTEROS_LAB_SSH_KEY_PATH=/root/lab-key\n`).ok).toBe(
      true,
    );
    expect(validateRouterOsLabConfig(base).missing).toContain('ROUTEROS_LAB_CREDENTIAL');
  });

  it('blocks hosted restore until an explicitly isolated target is complete and distinct', () => {
    const incomplete = validateHostedRestoreConfig('RESTORE_TARGET_CONFIRMED_ISOLATED=false\n');
    expect(incomplete.missing).toContain('RESTORE_TARGET_CONFIRMED_ISOLATED_TRUE');
    expect(incomplete.missing).toContain('RESTORE_TARGET_DB_URL');

    expect(validateHostedRestoreConfig(completeRestoreEnv)).toEqual({ ok: true, missing: [] });

    const sameDatabase = completeRestoreEnv
      .replace(`RESTORE_TARGET_PROJECT_REF=${TARGET_REF}`, `RESTORE_TARGET_PROJECT_REF=${SOURCE_REF}`)
      .replaceAll(TARGET_REF, SOURCE_REF.toUpperCase());
    expect(validateHostedRestoreConfig(sameDatabase).missing).toContain(
      'RESTORE_TARGET_DISTINCT_FROM_PRODUCTION',
    );
  });
});

describe('GL-02 authenticated evidence', () => {
  it('authenticates ownership/COMPLETE markers and rejects tampering', () => {
    const marker = createSignedMarker(
      { kind: 'COMPLETE', backupId: '20260809T220000Z', namespaceId: 'nugacore-production-0123456789abcdef' },
      'hmac-test-key',
    );
    expect(verifySignedMarker(marker, 'hmac-test-key')).toBe(true);
    expect(verifySignedMarker({ ...marker, backupId: '20260808T220000Z' }, 'hmac-test-key')).toBe(false);
  });

  it('requires DB, Storage, roles, Coolify, control-plane, manifest and RouterOS LAB evidence', () => {
    const evidence = createSignedMarker({
      version: 1,
      kind: 'RESTORE_EVIDENCE',
      status: 'verified',
      backupId: '20260809T220000Z',
      sourceProjectRefHash: 'a'.repeat(64),
      targetProjectRefHash: 'b'.repeat(64),
      sourceTargetDistinct: true,
      completeMarkerVerified: true,
      manifestVerified: true,
      databaseRestored: true,
      storageRestored: true,
      rolesVerified: true,
      coolifyVerified: true,
      controlPlaneVerified: true,
      routerOsLabRollbackVerified: true,
      rpoHours: 24,
      rtoHours: 4,
    }, 'evidence-key');
    expect(validateRestoreEvidence(evidence, 'evidence-key')).toEqual({ ok: true, missing: [] });
    expect(validateRestoreEvidence({ ...evidence, storageRestored: false }, 'evidence-key').missing).toContain(
      'EVIDENCE_STORAGE_RESTORED_TRUE',
    );
  });
});

describe('GL-02 destructive target guards', () => {
  it('accepts only canonical UTC backup directory identifiers', () => {
    expect(isBackupId('20260809T220000Z')).toBe(true);
    expect(isBackupId('../20260809T220000Z')).toBe(false);
    expect(isBackupId('2026-08-09T22:00:00Z')).toBe(false);
    expect(isBackupId('latest')).toBe(false);
  });

  it('prunes whole canonical backup directories and ignores every other remote entry', () => {
    const now = new Date('2026-08-31T00:00:00Z');
    expect(
      expiredBackupIds(
        ['20260701T000000Z', '20260815T000000Z', 'latest', '../20260701T000000Z'],
        30,
        now,
      ),
    ).toEqual(['20260701T000000Z']);
  });

  it('allows cleanup only under the dedicated GL-02 restore prefix', () => {
    expect(isSafeRestoreTempPath('/var/tmp/nugacore-gl02-restore.abcd')).toBe(true);
    expect(isSafeRestoreTempPath('/dev/shm/nugacore-gl02-restore.abcd')).toBe(true);
    expect(isSafeRestoreTempPath('/var/tmp/nugacore-gl02-restore')).toBe(false);
    expect(isSafeRestoreTempPath('/var/tmp')).toBe(false);
    expect(isSafeRestoreTempPath('/')).toBe(false);
  });
});
