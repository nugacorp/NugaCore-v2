import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationDriftReport,
  listLocalMigrations,
  resolveDatabaseUrl,
} from '../../scripts/report-migration-drift.mjs';

describe('migration drift report', () => {
  it('reports local migration totals and known duplicate versions', () => {
    const snapshot = listLocalMigrations();

    expect(snapshot.totalFiles).toBeGreaterThan(60);
    expect(snapshot.duplicateVersions.map((d) => d.version)).toEqual([
      '20260717040000',
      '20260717050000',
    ]);
  });

  it('marks remote checks external blocked when no SQL URL is configured', () => {
    const report = buildMigrationDriftReport({
      env: {},
      remoteState: null,
    });

    expect(report.status).toBe('EXTERNAL_BLOCKED');
    expect(report.remote.status).toBe('EXTERNAL_BLOCKED');
    expect(report.remote.reason).toContain('MIGRATION_DRIFT_DATABASE_URL');
    expect(report.criticalTenantTables.every((check) => check.status === 'EXTERNAL_BLOCKED')).toBe(true);
  });

  it('keeps documented historical drift as warnings, not blocking failures', () => {
    const local = listLocalMigrations();
    const report = buildMigrationDriftReport({
      local,
      remoteState: {
        migrationVersions: [...local.uniqueVersions, '20260619033952'],
        columnsByTable: completeCriticalColumns(),
      },
    });

    expect(report.status).toBe('WARNING');
    expect(report.remote.extraBlocking).toEqual([]);
    expect(report.remote.extraKnown).toEqual(['20260619033952']);
    expect(report.criticalTenantTables.every((check) => check.status === 'PASS')).toBe(true);
  });

  it('fails when a local migration is missing remotely or a critical tenant column is absent', () => {
    const local = listLocalMigrations();
    const remoteVersions = local.uniqueVersions.filter((version) => version !== '20260731053240');
    const columns = completeCriticalColumns();
    columns.inventory_transfers = ['id'];

    const report = buildMigrationDriftReport({
      local,
      remoteState: {
        migrationVersions: remoteVersions,
        columnsByTable: columns,
      },
    });

    expect(report.status).toBe('FAIL');
    expect(report.remote.missing).toContain('20260731053240');
    expect(report.criticalTenantTables.find((check) => check.id === 'inventory_transfers')?.status).toBe('FAIL');
  });

  it('does not contain mutating Supabase CLI operations', () => {
    const source = readFileSync('scripts/report-migration-drift.mjs', 'utf8');

    expect(source).not.toMatch(/supabase\s+db\s+push/i);
    expect(source).not.toMatch(/supabase\s+migration\s+repair/i);
    expect(source).not.toMatch(/\b(insert|update|delete|alter|drop|create)\b[\s\S]*schema_migrations/i);
  });

  it('requires an explicit drift database URL and does not default to production URLs', () => {
    expect(resolveDatabaseUrl({
      PRODUCTION_DB_URL: 'postgresql://prod.example/postgres',
    })).toBeNull();
    expect(resolveDatabaseUrl({
      MIGRATION_DRIFT_DATABASE_URL: 'postgresql://readonly.example/postgres',
      PRODUCTION_DB_URL: 'postgresql://prod.example/postgres',
    })).toBe('postgresql://readonly.example/postgres');
  });
});

function completeCriticalColumns(): Record<string, string[]> {
  return {
    tenants: ['id'],
    tenant_memberships: ['tenant_id', 'user_id'],
    users_profile: ['id', 'email'],
    clients: ['tenant_id'],
    plans: ['tenant_id'],
    invoices: ['tenant_id'],
    payments: ['tenant_id'],
    inventory_items: ['tenant_id'],
    warehouses: ['tenant_id'],
    inventory_transfers: ['tenant_id'],
    mikrotik_routers: ['tenant_id'],
    router_enrollment: ['tenant_id'],
    mikrotik_command_audit: ['tenant_id'],
    mikrotik_router_credentials: ['tenant_id'],
    wisp_integration_settings: ['tenant_id'],
  };
}
