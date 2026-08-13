#!/usr/bin/env node
// ====================================================================
// NugaCore migration drift report.
//
// Read-only by design:
// - Reads local files under supabase/migrations.
// - Optionally reads remote metadata through psql with PG* env vars.
// - Never calls mutating Supabase CLI migration commands or any DDL/DML command.
// ====================================================================

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KNOWN_DUPLICATE_VERSIONS = {
  20260717040000: {
    status: 'WARNING',
    reason: 'Historical timestamp collision: mikrotik_router_tenant + onboarding_status_fail_closed.',
    mitigation: 'Covered by 20260718175423_mikrotik_router_enrollment_tenant_id_reapply.sql.',
  },
  20260717050000: {
    status: 'WARNING',
    reason: 'Historical timestamp collision: multi_tenant_complete_ssot + olt_devices.',
    mitigation: 'Covered by 20260730120000_multi_tenant_complete_ssot_reapply.sql.',
  },
};

export const KNOWN_REMOTE_EXTRA_VERSIONS = {
  20260619033952: {
    status: 'WARNING',
    reason: 'Documented orphan migration history row for mikrotik_routers_reconciliation_strict_db1.',
    mitigation: 'Idempotent duplicate of 20260618000000_mikrotik_routers_reconciliation.sql; leave history intact.',
  },
};

export const CRITICAL_TABLE_CHECKS = [
  { id: 'tenants', label: 'tenants', required: [{ table: 'tenants', columns: ['id'] }] },
  {
    id: 'identity_memberships',
    label: 'memberships/users/profiles',
    required: [
      { table: 'tenant_memberships', columns: ['tenant_id', 'user_id'] },
      { table: 'users_profile', columns: ['id', 'email'] },
    ],
  },
  { id: 'customers', label: 'customers (clients)', required: [{ table: 'clients', columns: ['tenant_id'] }] },
  { id: 'plans', label: 'plans', required: [{ table: 'plans', columns: ['tenant_id'] }] },
  { id: 'invoices', label: 'invoices', required: [{ table: 'invoices', columns: ['tenant_id'] }] },
  { id: 'payments', label: 'payments', required: [{ table: 'payments', columns: ['tenant_id'] }] },
  { id: 'inventory_items', label: 'inventory_items', required: [{ table: 'inventory_items', columns: ['tenant_id'] }] },
  { id: 'warehouses', label: 'warehouses', required: [{ table: 'warehouses', columns: ['tenant_id'] }] },
  {
    id: 'inventory_transfers',
    label: 'inventory_transfers',
    required: [{ table: 'inventory_transfers', columns: ['tenant_id'] }],
  },
  { id: 'routers', label: 'routers (mikrotik_routers)', required: [{ table: 'mikrotik_routers', columns: ['tenant_id'] }] },
  {
    id: 'router_enrollments',
    label: 'router_enrollments (router_enrollment)',
    required: [{ table: 'router_enrollment', columns: ['tenant_id'] }],
  },
  {
    id: 'mikrotik_integration_tables',
    label: 'MikroTik integration tables',
    required: [
      { table: 'mikrotik_command_audit', columns: ['tenant_id'] },
      { table: 'mikrotik_router_credentials', columns: ['tenant_id'] },
      { table: 'wisp_integration_settings', columns: ['tenant_id'] },
    ],
  },
];

const DB_URL_ENV_KEYS = [
  'MIGRATION_DRIFT_DATABASE_URL',
  'STAGING_DATABASE_URL',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
];

const statusRank = { PASS: 0, WARNING: 1, EXTERNAL_BLOCKED: 2, FAIL: 3 };
const overallStatus = (statuses) =>
  statuses.reduce((current, next) => (statusRank[next] > statusRank[current] ? next : current), 'PASS');

const unique = (values) => [...new Set(values)];

const migrationVersionOf = (file) => {
  const match = basename(file).match(/^(\d{14})_/);
  return match?.[1] ?? null;
};

export function listLocalMigrations(migrationsDir = resolve('supabase/migrations')) {
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const migrations = files.map((file) => ({
    file,
    version: migrationVersionOf(file),
  }));
  const valid = migrations.filter((migration) => migration.version);
  const byVersion = new Map();
  for (const migration of valid) {
    const list = byVersion.get(migration.version) ?? [];
    list.push(migration.file);
    byVersion.set(migration.version, list);
  }
  const duplicateVersions = [...byVersion.entries()]
    .filter(([, versionFiles]) => versionFiles.length > 1)
    .map(([version, versionFiles]) => ({
      version,
      files: versionFiles,
      known: Boolean(KNOWN_DUPLICATE_VERSIONS[version]),
      note: KNOWN_DUPLICATE_VERSIONS[version] ?? null,
    }));

  return {
    migrationsDir,
    totalFiles: files.length,
    files,
    migrations: valid,
    invalidFiles: migrations.filter((migration) => !migration.version).map((migration) => migration.file),
    uniqueVersions: [...byVersion.keys()].sort(),
    duplicateVersions,
  };
}

export function resolveDatabaseUrl(env = process.env) {
  for (const key of DB_URL_ENV_KEYS) {
    const value = (env[key] || '').trim();
    if (value && !/^postgres(?:ql)?:\/\/\.\.\.?$/i.test(value)) return value;
  }
  return null;
}

function parsePostgresUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null;
    return {
      PGHOST: url.hostname,
      PGPORT: url.port || '5432',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '') || 'postgres'),
      PGSSLMODE: url.searchParams.get('sslmode') || 'require',
    };
  } catch {
    return null;
  }
}

function sanitizeMessage(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/([^:\s]+):([^@\s]+)@/gi, 'postgresql://$1:***@')
    .replace(/password=[^ \n\r\t]+/gi, 'password=***')
    .trim();
}

function psqlAvailable() {
  const result = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function remoteStateSql() {
  const tables = unique(
    CRITICAL_TABLE_CHECKS.flatMap((check) => check.required.map((requirement) => requirement.table)),
  );
  const tableList = tables.map((table) => `'${table.replace(/'/g, "''")}'`).join(',');
  return `
with migration_versions as (
  select coalesce(json_agg(version order by version), '[]'::json) as versions
    from supabase_migrations.schema_migrations
),
column_rows as (
  select table_name, json_agg(column_name order by column_name) as columns
    from information_schema.columns
   where table_schema = 'public'
     and table_name in (${tableList})
   group by table_name
),
table_columns as (
  select coalesce(json_object_agg(table_name, columns), '{}'::json) as columns
    from column_rows
)
select json_build_object(
  'migrationVersions', (select versions from migration_versions),
  'columnsByTable', (select columns from table_columns)
)::text;
`;
}

export function queryRemoteStateFromPsql(env = process.env) {
  const databaseUrl = resolveDatabaseUrl(env);
  if (!databaseUrl) {
    return {
      status: 'EXTERNAL_BLOCKED',
      reason: `No SQL URL configured. Set one of: ${DB_URL_ENV_KEYS.join(', ')}.`,
    };
  }

  const pgEnv = parsePostgresUrl(databaseUrl);
  if (!pgEnv) {
    return {
      status: 'FAIL',
      reason: 'Configured migration drift database URL is not a valid Postgres URL.',
    };
  }

  if (!psqlAvailable()) {
    return {
      status: 'EXTERNAL_BLOCKED',
      reason: 'psql is not available; install psql or run from the VPS/tooling host.',
    };
  }

  const result = spawnSync(
    'psql',
    ['-X', '-q', '-t', '-A', '--no-psqlrc', '--command', remoteStateSql()],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...pgEnv,
        PGCONNECT_TIMEOUT: env.PGCONNECT_TIMEOUT || '10',
      },
    },
  );

  if (result.error) {
    return { status: 'FAIL', reason: sanitizeMessage(result.error.message) };
  }
  if (result.status !== 0) {
    return { status: 'FAIL', reason: sanitizeMessage(result.stderr || result.stdout) };
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    return {
      status: 'PASS',
      migrationVersions: Array.isArray(parsed.migrationVersions) ? parsed.migrationVersions : [],
      columnsByTable: parsed.columnsByTable && typeof parsed.columnsByTable === 'object'
        ? parsed.columnsByTable
        : {},
    };
  } catch {
    return { status: 'FAIL', reason: 'Could not parse psql JSON output.' };
  }
}

export function evaluateCriticalTenantTables(columnsByTable) {
  if (!columnsByTable) {
    return CRITICAL_TABLE_CHECKS.map((check) => ({
      id: check.id,
      label: check.label,
      status: 'EXTERNAL_BLOCKED',
      missing: check.required.map((requirement) => `${requirement.table}.${requirement.columns.join('|')}`),
    }));
  }

  return CRITICAL_TABLE_CHECKS.map((check) => {
    const missing = [];
    for (const requirement of check.required) {
      const columns = new Set(columnsByTable[requirement.table] || []);
      for (const column of requirement.columns) {
        if (!columns.has(column)) missing.push(`${requirement.table}.${column}`);
      }
    }
    return {
      id: check.id,
      label: check.label,
      status: missing.length ? 'FAIL' : 'PASS',
      missing,
    };
  });
}

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   local?: ReturnType<typeof listLocalMigrations>,
 *   remoteState?: null | {
 *     status?: string,
 *     reason?: string,
 *     migrationVersions?: string[],
 *     columnsByTable?: Record<string, string[]>
 *   }
 * }} [options]
 */
export function buildMigrationDriftReport(options = {}) {
  const {
    env = process.env,
    local = listLocalMigrations(),
    remoteState,
  } = options;
  const remote = remoteState === undefined ? queryRemoteStateFromPsql(env) : remoteState;
  const knownDuplicates = local.duplicateVersions
    .filter((duplicate) => duplicate.known)
    .map((duplicate) => duplicate.version);
  const blockingDuplicates = local.duplicateVersions
    .filter((duplicate) => !duplicate.known)
    .map((duplicate) => duplicate.version);

  if (!remote || remote.status === 'EXTERNAL_BLOCKED') {
    const critical = evaluateCriticalTenantTables(null);
    return {
      status: 'EXTERNAL_BLOCKED',
      local,
      remote: {
        status: 'EXTERNAL_BLOCKED',
        reason: remote?.reason || `No SQL URL configured. Set one of: ${DB_URL_ENV_KEYS.join(', ')}.`,
        appliedCount: null,
        missing: [],
        extraKnown: [],
        extraBlocking: [],
      },
      knownDuplicates,
      blockingDuplicates,
      criticalTenantTables: critical,
    };
  }

  if (remote.status === 'FAIL') {
    const critical = evaluateCriticalTenantTables(null);
    return {
      status: 'FAIL',
      local,
      remote: {
        status: 'FAIL',
        reason: remote.reason || 'Remote migration query failed.',
        appliedCount: null,
        missing: [],
        extraKnown: [],
        extraBlocking: [],
      },
      knownDuplicates,
      blockingDuplicates,
      criticalTenantTables: critical,
    };
  }

  const localVersions = new Set(local.uniqueVersions);
  const remoteVersions = new Set(remote.migrationVersions || []);
  const missing = local.uniqueVersions.filter((version) => !remoteVersions.has(version));
  const extras = [...remoteVersions].filter((version) => !localVersions.has(version)).sort();
  const extraKnown = extras.filter((version) => KNOWN_REMOTE_EXTRA_VERSIONS[version]);
  const extraBlocking = extras.filter((version) => !KNOWN_REMOTE_EXTRA_VERSIONS[version]);
  const critical = evaluateCriticalTenantTables(remote.columnsByTable || {});
  const criticalFailures = critical.filter((check) => check.status === 'FAIL');

  const statuses = ['PASS'];
  if (knownDuplicates.length || extraKnown.length) statuses.push('WARNING');
  if (missing.length || extraBlocking.length || blockingDuplicates.length || criticalFailures.length) statuses.push('FAIL');

  return {
    status: overallStatus(statuses),
    local,
    remote: {
      status: 'PASS',
      appliedCount: remote.migrationVersions?.length ?? 0,
      missing,
      extraKnown,
      extraBlocking,
    },
    knownDuplicates,
    blockingDuplicates,
    criticalTenantTables: critical,
  };
}

function printReport(report) {
  console.log('\n=== NugaCore migration drift report (read-only) ===\n');
  console.log(`status: ${report.status}`);
  console.log(`local_migration_files: ${report.local.totalFiles}`);
  console.log(`local_unique_versions: ${report.local.uniqueVersions.length}`);
  console.log(`local_duplicate_versions: ${report.local.duplicateVersions.length || 0}`);
  for (const duplicate of report.local.duplicateVersions) {
    const marker = duplicate.known ? 'WARNING known' : 'FAIL blocking';
    console.log(`  - ${duplicate.version}: ${marker} (${duplicate.files.join(', ')})`);
  }

  console.log(`\nremote_status: ${report.remote.status}`);
  if (report.remote.reason) console.log(`remote_reason: ${report.remote.reason}`);
  if (report.remote.appliedCount !== null) console.log(`remote_applied_migrations: ${report.remote.appliedCount}`);
  if (report.remote.missing.length) console.log(`missing_remote: ${report.remote.missing.join(', ')}`);
  if (report.remote.extraKnown.length) console.log(`extra_remote_known: ${report.remote.extraKnown.join(', ')}`);
  if (report.remote.extraBlocking.length) console.log(`extra_remote_blocking: ${report.remote.extraBlocking.join(', ')}`);

  console.log('\ncritical_tenant_tables:');
  for (const check of report.criticalTenantTables) {
    const suffix = check.missing.length ? ` missing=${check.missing.join(',')}` : '';
    console.log(`  - ${check.status}: ${check.label}${suffix}`);
  }

  console.log('\nNo migrations were applied. No Supabase CLI mutation commands were used.\n');
}

export function runMigrationDriftCli({ env = process.env } = {}) {
  const report = buildMigrationDriftReport({ env });
  printReport(report);
  return report.status === 'FAIL' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runMigrationDriftCli());
}
