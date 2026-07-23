import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  resetHostApplyStateForTests,
  syncActivePeersToHost,
} from '../../backend/domains/wireguard/host-apply';
import { WireguardService } from '../../backend/domains/wireguard/service';
import { StoreWireguardRepository } from '../../backend/domains/wireguard/repository';
import { isWgKey } from '../../backend/domains/wireguard/keys';
import { createApp } from '../../backend/app';

// ====================================================================
// T3 — Contrato v2 + estados + gate + visibilidad global, todo detrás del
// flag WIREGUARD_MULTITENANT. Con el flag apagado: cero cambio (payload v1).
// Hermético: mock de fetch (POST /apply, GET /health).
// ====================================================================

const APPLY_URL = 'http://127.0.0.1:18765/apply';

interface ApplyCall { schemaVersion?: number; revision?: number; tenantSubnets?: string[];
  peers: Array<{ publicKey: string; allocatedIp: string; presharedKey?: string; tenantSubnet?: string }>; }

/** Mock de fetch: /health acredita capacidad v2; /apply devuelve ok + echo de revisión. */
const installFetch = (opts: { applyOk?: boolean; healthOk?: boolean } = {}) => {
  const applyOk = opts.applyOk ?? true;
  const healthOk = opts.healthOk ?? true;
  const applyCalls: ApplyCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET' || String(url).endsWith('/health')) {
      return new Response(
        JSON.stringify({ ok: healthOk, schemaVersion: 2, firewall: healthOk, revision: 0 }),
        { status: healthOk ? 200 : 503 },
      );
    }
    const body = JSON.parse(String(init?.body || '{}')) as ApplyCall;
    applyCalls.push(body);
    if (!applyOk) return new Response('down', { status: 503 });
    return new Response(
      JSON.stringify({ ok: true, peers: body.peers.length, revision: body.revision, digest: 'digest-x', schemaVersion: 2 }),
      { status: 200 },
    );
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { applyCalls, fetchMock };
};

const newService = () => new WireguardService(new StoreWireguardRepository());

describe('WireGuard multi-tenant (flag WIREGUARD_MULTITENANT)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetHostApplyStateForTests();
    process.env.WIREGUARD_HOST_APPLY_URL = APPLY_URL;
    delete process.env.WIREGUARD_MULTITENANT;
  });
  afterEach(() => {
    resetHostApplyStateForTests();
    globalThis.fetch = originalFetch;
    delete process.env.WIREGUARD_HOST_APPLY_URL;
    delete process.env.WIREGUARD_MULTITENANT;
  });

  it('flag apagado ⇒ payload v1 (sin schemaVersion, sin PSK) — no regresión', async () => {
    const { applyCalls } = installFetch();
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'vpn.local' });
    await svc.createPeer({ serverId: srv.server.id, name: 'R1' });

    const last = applyCalls[applyCalls.length - 1];
    expect(last.schemaVersion).toBeUndefined();
    expect(last.revision).toBeUndefined();
    expect(last.tenantSubnets).toBeUndefined();
    expect(last.peers[0].presharedKey).toBeUndefined();
    expect(last.peers[0].allocatedIp).toBe('10.70.0.2');
  });

  it('flag encendido ⇒ payload v2 con PSK descifrada, tenantSubnet y tenantSubnets', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    const { applyCalls } = installFetch();
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'vpn.local', isDefault: true });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' }); // tenant-default = bloque 0

    const last = applyCalls[applyCalls.length - 1];
    expect(last.schemaVersion).toBe(2);
    expect(typeof last.revision).toBe('number');
    expect(last.tenantSubnets).toContain('10.70.0.0/24');
    expect(last.peers[0].tenantSubnet).toBe('10.70.0.0/24');
    // PSK descifrada en el borde del POST (base64 WG válida, = a la de una-vez).
    expect(isWgKey(last.peers[0].presharedKey!)).toBe(true);
    expect(last.peers[0].presharedKey).toBe(peer.presharedKey);
    // Estado: applied tras el ACK.
    expect(peer.peer.applyState).toBe('applied');
  });

  it('revisión monotónica por mutación; el reconcile reenvía la misma', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    const { applyCalls } = installFetch();
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    const rev1 = applyCalls[applyCalls.length - 1].revision;
    await svc.createPeer({ serverId: srv.server.id, name: 'R2' });
    const rev2 = applyCalls[applyCalls.length - 1].revision;
    expect(rev2!).toBeGreaterThan(rev1!);

    // Reconcile: reenvía la MISMA revisión (sin bump).
    await syncActivePeersToHost();
    const revReconcile = applyCalls[applyCalls.length - 1].revision;
    expect(revReconcile).toBe(rev2);
  });

  it('apply fallido ⇒ peer queda apply_failed (no se traga el error)', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch({ applyOk: false });
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    expect(peer.peer.applyState).toBe('apply_failed');
    // El peer existe y conserva secretos (config no perdida).
    expect(isWgKey(peer.privateKey)).toBe(true);
    expect(isWgKey(peer.presharedKey)).toBe(true);
  });

  it('gate de capacidad: alta fuera del bloque 0 sin agente v2 acreditado ⇒ bloqueada (fail-closed)', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch({ healthOk: false });
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    await expect(
      svc.createPeer({ serverId: srv.server.id, name: 'R1', tenantId: 'wisp-2' }),
    ).rejects.toThrow(/fail-closed|capacidad/i);
  });

  it('bloque 0 (tenant-default) NO exige gate de capacidad', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch({ healthOk: false }); // health caído, pero bloque 0 no lo consulta
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    expect(peer.peer.applyState).toBe('applied');
  });

  it('alta multi-tenant válida asigna IP en el /24 del WISP', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    const { applyCalls } = installFetch();
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1', tenantId: 'wisp-2' });
    expect(peer.assignedIp).toBe('10.70.1.2/32');
    const last = applyCalls[applyCalls.length - 1];
    expect(last.tenantSubnets).toEqual(expect.arrayContaining(['10.70.0.0/24', '10.70.1.0/24']));
    expect(last.peers.find((p) => p.allocatedIp === '10.70.1.2')?.tenantSubnet).toBe('10.70.1.0/24');
  });

  it('cuota agotada ⇒ error comercial con el límite del plan', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch();
    const repo = new StoreWireguardRepository();
    // Cuota 1 para el WISP.
    repo.SUBNETS.push({ tenantId: 'wisp-q', subnetCidr: '10.70.5.0/24', subnetIndex: 5, maxPeers: 1 });
    const svc = new WireguardService(repo);
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    await svc.createPeer({ serverId: srv.server.id, name: 'R1', tenantId: 'wisp-q' });
    await expect(
      svc.createPeer({ serverId: srv.server.id, name: 'R2', tenantId: 'wisp-q' }),
    ).rejects.toThrow(/Límite de 1 equipos del plan/);
  });

  it('visibilidad global: un WISP ve el servidor singleton y su previewNextIp cae en su bloque', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch();
    const svc = newService();
    // Servidor creado por tenant-default (plataforma).
    await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true, tenantId: 'tenant-default' });
    // Otro tenant lo ve (sin filtro).
    const seen = await svc.getDefaultServer('wisp-2');
    expect(seen).not.toBeNull();
    const preview = await svc.previewNextIp(undefined, 'wisp-2');
    expect(preview.ip).toBe('10.70.1.2'); // próximo bloque del WISP nuevo
  });
});

describe('WireGuard multi-tenant — RBAC de mutación de servidor', () => {
  const SA = { 'x-user-role': 'super admin', 'x-user-id': 'sa' };
  const ADM = { 'x-user-role': 'administrador', 'x-user-id': 'adm' };
  const body = { name: 'VPN', endpointHost: 'vpn.local' };

  afterEach(() => { delete process.env.WIREGUARD_MULTITENANT; });

  it('flag apagado: administrador SÍ puede crear servidor (comportamiento actual)', async () => {
    delete process.env.WIREGUARD_MULTITENANT;
    const app = createApp();
    expect((await request(app).post('/api/wireguard/servers').set(ADM).send(body)).status).toBe(201);
  });

  it('flag encendido: sólo super admin muta el servidor global; administrador → 403', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    const app = createApp();
    expect((await request(app).post('/api/wireguard/servers').set(ADM).send(body)).status).toBe(403);
    expect((await request(app).post('/api/wireguard/servers').set(SA).send(body)).status).toBe(201);
  });
});
