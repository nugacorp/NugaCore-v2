import { describe, it, expect } from 'vitest';
import { nextFreeIp } from '../../backend/domains/wireguard/ipam';
import { StoreWireguardRepository } from '../../backend/domains/wireguard/repository';
import type { AllocatePeerInput } from '../../backend/domains/wireguard/types';

// ====================================================================
// WireGuard multi-tenant · Fundación DB (T1) — IPAM atómico.
//
// Réplica en memoria (StoreWireguardRepository) de la semántica del RPC
// wg_allocate_peer: subred /24 por tenant, cuota por equipment, IP dentro
// del bloque sin fuga entre bloques. Hermético (sin DB).
// ====================================================================

let counter = 0;
const input = (over: Partial<AllocatePeerInput> & { tenantId: string; serverId: string }): AllocatePeerInput => {
  counter += 1;
  return {
    peerId: `wgp-${counter}`,
    allocId: `wgip-${counter}`,
    name: `peer-${counter}`,
    publicKey: `pub-${counter}`,
    peerType: 'equipment',
    ...over,
  };
};

describe('nextFreeIp acotado al CIDR (fix de fuga entre bloques)', () => {
  it('NO reutiliza una liberada de otro bloque', () => {
    const allocs = [
      { ip: '10.70.1.5', status: 'released' as const }, // otro bloque
      { ip: '10.70.2.2', status: 'allocated' as const },
    ];
    // Pidiendo el bloque 10.70.2.0/24: la liberada .1.5 no debe fugarse.
    expect(nextFreeIp(allocs, '10.70.2.0/24', ['10.70.2.1'])).toBe('10.70.2.3');
  });

  it('SÍ reutiliza la liberada más baja del bloque pedido', () => {
    const allocs = [
      { ip: '10.70.2.3', status: 'released' as const },
      { ip: '10.70.2.2', status: 'allocated' as const },
    ];
    expect(nextFreeIp(allocs, '10.70.2.0/24', ['10.70.2.1'])).toBe('10.70.2.3');
  });

  it('empieza en .2 respetando la reservada .1 del bloque', () => {
    expect(nextFreeIp([], '10.70.7.0/24', ['10.70.7.1'])).toBe('10.70.7.2');
  });
});

describe('StoreWireguardRepository.allocatePeer', () => {
  const SERVER = 'wgs-1';

  it('asigna subnet_index secuencial a tenants nuevos (bloque 0 sembrado)', async () => {
    const repo = new StoreWireguardRepository();
    const a = await repo.allocatePeer(input({ tenantId: 't-a', serverId: SERVER }));
    const b = await repo.allocatePeer(input({ tenantId: 't-b', serverId: SERVER }));
    expect(a.subnet.subnetIndex).toBe(1);
    expect(a.subnet.subnetCidr).toBe('10.70.1.0/24');
    expect(a.allocation.ip).toBe('10.70.1.2');
    expect(b.subnet.subnetIndex).toBe(2);
    expect(b.allocation.ip).toBe('10.70.2.2');
    // Índices únicos entre tenants.
    const subs = await repo.listSubnets();
    expect(new Set(subs.map((s) => s.subnetIndex)).size).toBe(subs.length);
  });

  it('asigna IPs secuenciales dentro del /24 del mismo tenant', async () => {
    const repo = new StoreWireguardRepository();
    const p1 = await repo.allocatePeer(input({ tenantId: 't-x', serverId: SERVER }));
    const p2 = await repo.allocatePeer(input({ tenantId: 't-x', serverId: SERVER }));
    expect(p1.allocation.ip).toBe('10.70.1.2');
    expect(p2.allocation.ip).toBe('10.70.1.3');
    expect(p1.subnet.subnetIndex).toBe(p2.subnet.subnetIndex);
  });

  it('reutiliza la IP liberada del bloque, sin cruzar a otro tenant', async () => {
    const repo = new StoreWireguardRepository();
    const p1 = await repo.allocatePeer(input({ tenantId: 't-y', serverId: SERVER })); // 10.70.1.2
    const p2 = await repo.allocatePeer(input({ tenantId: 't-y', serverId: SERVER })); // 10.70.1.3
    // Revoca p1 y libera su IP (como haría revokePeer).
    const peer1 = repo.PEERS.find((p) => p.id === p1.peer.id)!;
    peer1.status = 'revoked';
    const alloc1 = repo.ALLOCATIONS.find((a) => a.id === p1.allocation.id)!;
    alloc1.status = 'released';
    const p3 = await repo.allocatePeer(input({ tenantId: 't-y', serverId: SERVER }));
    expect(p3.allocation.ip).toBe('10.70.1.2'); // reusa la liberada más baja
    expect(p3.allocation.ip).not.toBe(p2.allocation.ip);
  });

  it('respeta la cuota exacta (equipment activos < max_peers)', async () => {
    const repo = new StoreWireguardRepository();
    // Subred con cuota 2 para el tenant.
    repo.SUBNETS.push({ tenantId: 't-q', subnetCidr: '10.70.9.0/24', subnetIndex: 9, maxPeers: 2 });
    await repo.allocatePeer(input({ tenantId: 't-q', serverId: SERVER }));
    await repo.allocatePeer(input({ tenantId: 't-q', serverId: SERVER }));
    await expect(repo.allocatePeer(input({ tenantId: 't-q', serverId: SERVER })))
      .rejects.toThrow('quota_exceeded');
  });

  it('los peers person NO consumen cuota de equipment', async () => {
    const repo = new StoreWireguardRepository();
    repo.SUBNETS.push({ tenantId: 't-p', subnetCidr: '10.70.11.0/24', subnetIndex: 11, maxPeers: 1 });
    await repo.allocatePeer(input({ tenantId: 't-p', serverId: SERVER })); // equipment, llena la cuota
    // Un person adicional debe pasar pese a max_peers=1.
    const person = await repo.allocatePeer(input({ tenantId: 't-p', serverId: SERVER, peerType: 'person' }));
    expect(person.peer.peerType).toBe('person');
  });

  it('serializa altas concurrentes y no excede la cuota', async () => {
    const repo = new StoreWireguardRepository();
    repo.SUBNETS.push({ tenantId: 't-c', subnetCidr: '10.70.13.0/24', subnetIndex: 13, maxPeers: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => repo.allocatePeer(input({ tenantId: 't-c', serverId: SERVER }))),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(3);
    expect(failed.length).toBe(2);
    // Sin IPs duplicadas entre los que sí entraron.
    const ips = ok.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof repo.allocatePeer>>>).value.allocation.ip);
    expect(new Set(ips).size).toBe(3);
  });
});
