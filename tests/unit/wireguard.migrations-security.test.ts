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

  it('ACKs an exact peer-id snapshot and never regresses applied_revision', () => {
    expect(applyState).toContain('public.wg_ack_applied_snapshot(bigint, text, text[])');
    expect(applyState).toMatch(/id\s*=\s*ANY\s*\(p_peer_ids\)/i);
    expect(applyState).toMatch(/GREATEST\s*\(/i);
    expect(applyState).toContain(
      'GRANT EXECUTE ON FUNCTION public.wg_ack_applied_snapshot(bigint, text, text[]) TO service_role;',
    );
  });
});
