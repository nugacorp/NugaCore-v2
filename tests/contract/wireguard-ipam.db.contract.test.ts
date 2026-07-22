// ====================================================================
// WireGuard IPAM atómico — contrato modo DB (Supabase real). NO hermético.
//
// Opt-in EXPLÍCITO: solo corre con RUN_DB_TESTS=true (npm run test:db).
// Sin ese flag se OMITE, para que `npm test` sea hermético.
//
// Verifica el RPC wg_allocate_peer (migración 20260722120000):
//   - 31 altas concurrentes con cuota 30 → exactamente 30 (resto quota_exceeded).
//   - Primer peer concurrente de 2 tenants → índices de subred distintos.
//   - IP activa duplicada imposible (índice único parcial uniq_wg_peers_active_ip).
// ====================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SupabaseWireguardRepository } from '../../backend/domains/wireguard/repository';
import type { AllocatePeerInput } from '../../backend/domains/wireguard/types';

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const DB_TIMEOUT_MS = 30000;

const RUN = `wgipam-${Date.now()}`;
const SERVER_ID = `${RUN}-srv`;
const T1 = `${RUN}-t1`;
const T2 = `${RUN}-t2`;

if (optIn && !hasSupabase) {
  describe('WireGuard IPAM DB contract — configuración requerida', () => {
    it('RUN_DB_TESTS=true exige SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY', () => {
      throw new Error('RUN_DB_TESTS=true pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.');
    });
  });
}

const peerInput = (tenantId: string, n: number, over: Partial<AllocatePeerInput> = {}): AllocatePeerInput => ({
  tenantId,
  serverId: SERVER_ID,
  peerId: `${RUN}-p-${tenantId}-${n}`,
  allocId: `${RUN}-a-${tenantId}-${n}`,
  name: `peer-${tenantId}-${n}`,
  publicKey: `pub-${RUN}-${tenantId}-${n}`,
  peerType: 'equipment',
  ...over,
});

describe.skipIf(!optIn || !hasSupabase)('WireGuard IPAM DB contract (Supabase staging)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any;
  let repo: SupabaseWireguardRepository;

  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    repo = new SupabaseWireguardRepository(supabase);

    // Tenants de prueba (aislados de tenant-default para no chocar con datos reales).
    await supabase.from('tenants').upsert([
      { id: T1, name: 'WG IPAM T1', slug: T1, status: 'active' },
      { id: T2, name: 'WG IPAM T2', slug: T2, status: 'active' },
    ], { onConflict: 'id' });

    // Servidor singleton de prueba (no default, para no tocar el índice global).
    await supabase.from('wireguard_servers').upsert({
      id: SERVER_ID, name: 'WG IPAM Test', endpoint_host: 'vpn.ipam.test',
      public_key: `srvpub-${RUN}`, encrypted_private_key: 'iv.tag.ct', is_default: false, status: 'active',
    }, { onConflict: 'id' });

    // Cuota 30 explícita para T1 (default de la tabla, explícito por claridad).
    await supabase.from('wireguard_tenant_subnets').upsert(
      { tenant_id: T1, subnet_cidr: '10.70.100.0/24', subnet_index: 100, max_peers: 30 },
      { onConflict: 'tenant_id' },
    );
  }, DB_TIMEOUT_MS);

  afterAll(async () => {
    // Limpieza en orden de FK: allocations → rotations → peers → subnets → server → tenants.
    await supabase.from('wireguard_ip_allocations').delete().eq('server_id', SERVER_ID);
    await supabase.from('wireguard_key_rotations').delete().in('tenant_id', [T1, T2]);
    await supabase.from('wireguard_peers').delete().eq('server_id', SERVER_ID);
    await supabase.from('wireguard_tenant_subnets').delete().in('tenant_id', [T1, T2]);
    await supabase.from('wireguard_servers').delete().eq('id', SERVER_ID);
    await supabase.from('tenants').delete().in('id', [T1, T2]);
  }, DB_TIMEOUT_MS);

  it('31 altas concurrentes con cuota 30 → exactamente 30, sin IP duplicada', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 31 }, (_, i) => repo.allocatePeer(peerInput(T1, i))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<SupabaseWireguardRepository['allocatePeer']>>
    >[];
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(ok.length).toBe(30);
    expect(rejected.length).toBe(1);
    expect(String(rejected[0].reason)).toContain('quota_exceeded');

    const ips = ok.map((r) => r.value.allocation.ip);
    expect(new Set(ips).size).toBe(30);               // sin duplicados
    expect(ips.every((ip) => ip.startsWith('10.70.100.'))).toBe(true); // dentro del /24
  }, DB_TIMEOUT_MS);

  it('primer peer concurrente de 2 tenants → subredes con índices distintos', async () => {
    const [a, b] = await Promise.all([
      repo.allocatePeer(peerInput(T2, 0)),
      repo.allocatePeer(peerInput(`${T2}`, 1, { tenantId: T2, peerId: `${RUN}-p-t2b`, allocId: `${RUN}-a-t2b` })),
    ]);
    // Ambos son del mismo tenant T2 → mismo índice, IPs distintas (serializadas).
    expect(a.subnet.subnetIndex).toBe(b.subnet.subnetIndex);
    expect(a.allocation.ip).not.toBe(b.allocation.ip);

    // T1 (índice 100) y T2 tienen bloques distintos.
    const subs = await repo.listSubnets();
    const t1 = subs.find((s) => s.tenantId === T1);
    const t2 = subs.find((s) => s.tenantId === T2);
    expect(t1 && t2 && t1.subnetIndex !== t2.subnetIndex).toBe(true);
  }, DB_TIMEOUT_MS);

  it('el índice único parcial impide una IP activa duplicada en el mismo servidor', async () => {
    const first = await repo.allocatePeer(peerInput(T2, 50));
    const { error } = await supabase.from('wireguard_peers').insert({
      id: `${RUN}-dup`, server_id: SERVER_ID, name: 'dup', public_key: `dup-${RUN}`,
      allocated_ip: first.allocation.ip, status: 'active', peer_type: 'equipment', tenant_id: T2,
    });
    expect(error).toBeTruthy(); // viola uniq_wg_peers_active_ip
  }, DB_TIMEOUT_MS);
});
