import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260716200000_multi_tenant_foundation.sql',
);

describe('Multi-tenant migration security invariants', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('is_tenant_member no lee user_metadata (escalada de privilegios)', () => {
    expect(sql).not.toMatch(/user_metadata/);
    expect(sql).toMatch(/tenant_memberships/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_tenant_member/);
  });

  it('no abre políticas authenticated FOR ALL sobre SSOT', () => {
    expect(sql).not.toMatch(/FOR ALL TO authenticated/i);
    expect(sql).not.toMatch(/_authenticated_tenant/i);
    // service_role documentado sí
    expect(sql).toMatch(/clients_service_role/);
    expect(sql).toMatch(/invoices_service_role/);
  });

  it('documenta que MULTI_TENANT_ENABLED no apaga RLS', () => {
    expect(sql).toMatch(/MULTI_TENANT_ENABLED/);
    expect(sql).toMatch(/superficie de ataque/i);
  });
});
