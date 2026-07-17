import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260716200000_multi_tenant_foundation.sql',
);

describe('Multi-tenant migration security invariants', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  /** Cuerpo de is_tenant_member (entre AS $$ y $$;) — sin comentarios de cabecera. */
  const functionBody = (() => {
    const match = sql.match(
      /CREATE OR REPLACE FUNCTION public\.is_tenant_member[\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
    );
    return match?.[1] ?? '';
  })();

  it('is_tenant_member solo usa memberships (sin claims JWT)', () => {
    expect(functionBody).toMatch(/tenant_memberships/);
    expect(functionBody).not.toMatch(/user_metadata/);
    expect(functionBody).not.toMatch(/app_metadata/);
    expect(functionBody).not.toMatch(/auth\.jwt\s*\(/);
  });

  it('no abre políticas authenticated FOR ALL sobre SSOT', () => {
    expect(sql).not.toMatch(/FOR ALL TO authenticated/i);
    expect(sql).not.toMatch(/_authenticated_tenant/i);
    expect(sql).toMatch(/clients_service_role/);
    expect(sql).toMatch(/invoices_service_role/);
  });

  it('documenta que MULTI_TENANT_ENABLED no apaga RLS', () => {
    expect(sql).toMatch(/MULTI_TENANT_ENABLED/);
    expect(sql).toMatch(/superficie de ataque/i);
  });

  it('is_tenant_member no concede EXECUTE a anon/authenticated', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.is_tenant_member\(TEXT\) FROM anon/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.is_tenant_member\(TEXT\) FROM authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_tenant_member\(TEXT\) TO service_role/i,
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_tenant_member\(TEXT\) TO authenticated/i,
    );
  });
});

describe('Revoke is_tenant_member execute migration', () => {
  const revokeSql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260717013000_revoke_is_tenant_member_execute.sql'),
    'utf8',
  );

  it('revoca anon/authenticated y deja solo service_role', () => {
    expect(revokeSql).toMatch(/REVOKE ALL ON FUNCTION public\.is_tenant_member\(TEXT\) FROM anon/i);
    expect(revokeSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.is_tenant_member\(TEXT\) FROM authenticated/i,
    );
    expect(revokeSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.is_tenant_member\(TEXT\) TO service_role/i,
    );
  });
});
