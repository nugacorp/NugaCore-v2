import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(process.cwd(), 'supabase/migrations');

describe('RLS auth_rls_initplan (lint 0003)', () => {
  it('migración de remediación usa (select auth.role())', () => {
    const sql = readFileSync(
      resolve(migrationsDir, '20260717020000_rls_auth_initplan_service_role.sql'),
      'utf8',
    );
    expect(sql).toMatch(/\(select auth\.role\(\)\)/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS/i);
    expect(sql).toMatch(/pg_policies/i);
  });

  it('migraciones que crean políticas service_role no usan auth.role() bare', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const offenders: string[] = [];
    for (const file of files) {
      if (file === '20260717020000_rls_auth_initplan_service_role.sql') continue;
      const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
      // Bare auth.role() in policy expressions (not already wrapped by select).
      const withoutSelectWrapped = sql.replace(/\(select\s+auth\.role\(\)\)/gi, '');
      if (/auth\.role\(\)/i.test(withoutSelectWrapped)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
