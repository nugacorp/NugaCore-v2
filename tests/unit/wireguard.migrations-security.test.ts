import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ipam = readFileSync(
  'supabase/migrations/20260722120000_wg_tenant_subnets_singleton_ipam.sql',
  'utf8',
);
const applyState = readFileSync(
  'supabase/migrations/20260723120000_wg_apply_state_revision.sql',
  'utf8',
);
const tenantColumnsReconcile = readFileSync(
  'supabase/migrations/20260723230000_wireguard_tenant_columns_reconcile.sql',
  'utf8',
);

describe('WireGuard migrations — RPC security and concurrency contracts', () => {
  it('grants allocator and revision RPCs only to service_role', () => {
    for (const [sql, signature] of [
      [ipam, 'public.wg_allocate_peer(text, text, jsonb)'],
      [applyState, 'public.wg_bump_revision()'],
    ] as const) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
  });

  it('serializes global subnet allocation and bounds unique-violation retries', () => {
    expect(ipam).toMatch(/pg_advisory_xact_lock\s*\(\s*hashtext\('wg_allocate_peer:subnet'\)\s*\)/);
    expect(ipam).toMatch(/FOR\s+v_subnet_attempt\s+IN\s+1\.\.3\s+LOOP/i);
    expect(ipam).toMatch(/WHEN\s+unique_violation\s+THEN/i);
  });

  it('fails before the active-IP unique index when legacy duplicates exist', () => {
    const preflight = ipam.indexOf('wireguard_active_ip_duplicates');
    const uniqueIndex = ipam.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uniq_wg_peers_active_ip');
    expect(preflight).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(preflight);
    expect(ipam).toContain('duplicate group(s)');
    expect(ipam).toContain('sample peer ids');
  });

  it('creates peers pending_apply inside the allocator transaction', () => {
    expect(ipam).toMatch(/status,\s*apply_state,\s*peer_type/i);
    expect(ipam).toMatch(/'active',\s*'pending_apply',\s*v_peer_type/i);
  });

  it('bumps desired revision inside allocate/rotate/revoke content mutations', () => {
    // allocate: bump en el mismo cuerpo, antes del RETURN
    const allocFn = ipam.slice(ipam.indexOf('CREATE OR REPLACE FUNCTION public.wg_allocate_peer'));
    expect(allocFn).toMatch(/wireguard_apply_state[\s\S]+revision\s*=[\s\S]+revision\s*\+\s*1/i);
    expect(allocFn.indexOf('revision')).toBeLessThan(allocFn.lastIndexOf('RETURN jsonb_build_object'));

    expect(applyState).toContain('public.wg_rotate_peer(');
    expect(applyState).toContain('public.wg_revoke_peer(');
    for (const name of ['wg_rotate_peer', 'wg_revoke_peer'] as const) {
      const fn = applyState.slice(applyState.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`));
      expect(fn).toMatch(/FOR\s+UPDATE/i);
      expect(fn).toMatch(/revision\s*=[\s\S]+revision\s*\+\s*1/i);
      expect(applyState).toContain(`GRANT EXECUTE ON FUNCTION public.${name}`);
    }
  });

  it('locks and validates the ACK revision/digest before updating exact peer IDs', () => {
    expect(applyState).toContain('public.wg_ack_applied_snapshot(bigint, text, text[])');
    const ackFunction = applyState.slice(applyState.indexOf('CREATE OR REPLACE FUNCTION public.wg_ack_applied_snapshot'));
    const lock = ackFunction.search(/SELECT\s+revision\s*,\s*applied_revision\s*,\s*applied_digest[\s\S]+FOR\s+UPDATE/i);
    const digestValidation = ackFunction.search(/p_digest\s+IS\s+DISTINCT\s+FROM\s+v_applied_digest/i);
    const peerUpdate = ackFunction.indexOf('UPDATE public.wireguard_peers');
    expect(lock).toBeGreaterThan(-1);
    expect(digestValidation).toBeGreaterThan(lock);
    expect(peerUpdate).toBeGreaterThan(digestValidation);
    expect(ackFunction).toMatch(/p_revision\s*<\s*v_desired_revision/i);
    expect(ackFunction).toMatch(/p_revision\s*>\s*v_desired_revision/i);
    expect(ackFunction).toMatch(/p_revision\s*=\s*v_applied_revision/i);
    expect(ackFunction).toMatch(/id\s*=\s*ANY\s*\(p_peer_ids\)/i);
    expect(applyState).toContain(
      'GRANT EXECUTE ON FUNCTION public.wg_ack_applied_snapshot(bigint, text, text[]) TO service_role;',
    );
  });

  it('reconciles tenant columns for WireGuard child tables without cross-tenant fallback', () => {
    for (const table of ['wireguard_ip_allocations', 'wireguard_key_rotations']) {
      expect(tenantColumnsReconcile).toContain(
        `ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS tenant_id text`,
      );
      expect(tenantColumnsReconcile).toContain(`idx_${table}_tenant_id`);
      expect(tenantColumnsReconcile).toContain(
        `ALTER TABLE public.${table} ALTER COLUMN tenant_id SET NOT NULL`,
      );
    }

    expect(tenantColumnsReconcile).toMatch(
      /wireguard_ip_allocations[\s\S]+wireguard_peers[\s\S]+a\.peer_id\s*=\s*p\.id/i,
    );
    expect(tenantColumnsReconcile).toMatch(
      /wireguard_key_rotations[\s\S]+wireguard_peers[\s\S]+r\.peer_id\s*=\s*p\.id/i,
    );
    expect(tenantColumnsReconcile).toContain('wireguard_tenant_backfill_failed');
    expect(tenantColumnsReconcile).not.toMatch(/SET\s+tenant_id\s*=\s*'tenant-default'/i);
  });
});
