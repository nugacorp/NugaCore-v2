import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import {
  applyStateToHost,
  configureHostApplyStateLoader,
  resetHostApplyStateForTests,
  syncActivePeersToHost,
} from '../../backend/domains/wireguard/host-apply';
import { WireguardService, resetWireguardService } from '../../backend/domains/wireguard/service';
import { StoreWireguardRepository } from '../../backend/domains/wireguard/repository';
import { generatePresharedKey, isWgKey } from '../../backend/domains/wireguard/keys';
import { createApp } from '../../backend/app';
import { encryptSecret } from '../../backend/services/crypto';

// ====================================================================
// T3 — Contrato v2 + estados + gate + visibilidad global, todo detrás del
// flag WIREGUARD_MULTITENANT. Con el flag apagado: cero cambio (payload v1).
// Hermético: mock de fetch (POST /apply, GET /health).
// ====================================================================

const APPLY_URL = 'http://127.0.0.1:18765/apply';

interface ApplyCall { schemaVersion?: number; revision?: number; tenantSubnets?: string[];
  peers: Array<{ publicKey: string; allocatedIp: string; presharedKey?: string; tenantSubnet?: string }>; }

/** Mock de fetch: /health acredita capacidad v2; /apply devuelve ok + echo de revisión. */
const installFetch = (opts: { applyOk?: boolean; healthOk?: boolean; firewallReady?: boolean } = {}) => {
  const applyOk = opts.applyOk ?? true;
  const healthOk = opts.healthOk ?? true;
  const firewallReady = opts.firewallReady ?? healthOk;
  const applyCalls: ApplyCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'GET' || String(url).endsWith('/health')) {
      return new Response(
        JSON.stringify({ ok: healthOk, schemaVersion: 2, firewall: firewallReady, revision: 0 }),
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
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });

    const last = applyCalls[applyCalls.length - 1];
    expect(last.schemaVersion).toBeUndefined();
    expect(last.revision).toBeUndefined();
    expect(last.tenantSubnets).toBeUndefined();
    expect(last.peers[0].presharedKey).toBeUndefined();
    expect(last.peers[0].allocatedIp).toBe('10.70.0.2');
    expect(peer.peer).not.toHaveProperty('applyState');
    expect((await svc.listPeers())[0]).not.toHaveProperty('applyState');
  });

  it('flag apagado preserva el startAt legacy en .2 aunque serverVpnIp sea distinto', async () => {
    installFetch();
    const svc = newService();
    const srv = await svc.createServer({
      name: 'VPN legacy', endpointHost: 'vpn.local', vpnCidr: '10.70.0.0/29', serverVpnIp: '10.70.0.5',
    });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    expect(peer.assignedIp).toBe('10.70.0.2/32');
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

  it('gate de capacidad rechaza health OK si el firewall estructural no está formado', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch({ healthOk: true, firewallReady: false });
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    await expect(
      svc.createPeer({ serverId: srv.server.id, name: 'R1', tenantId: 'wisp-firewall' }),
    ).rejects.toThrow(/fail-closed|firewall/i);
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

  it('create→reuse de router en tenant no-default busca el servidor singleton global', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch();
    const svc = newService();
    const srv = await svc.createServer({
      name: 'VPN', endpointHost: 'h', isDefault: true, tenantId: 'tenant-default',
    });
    const first = await svc.getPeerConfigForRouter('router-wisp', srv.server.id, 'actor', 'wisp-2');
    const reused = await svc.getPeerConfigForRouter('router-wisp', srv.server.id, 'actor', 'wisp-2');
    expect(reused.peer.id).toBe(first.peer.id);
    expect(reused.serverPublicKey).toBe(srv.server.publicKey);
  });

  it('getTenantBlock reporta bloque + uso de cuota del tenant', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch();
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    await svc.createPeer({ serverId: srv.server.id, name: 'R1', tenantId: 'wisp-2' });
    const block = await svc.getTenantBlock('wisp-2');
    expect(block.subnetCidr).toBe('10.70.1.0/24');
    expect(block.maxPeers).toBe(30);
    expect(block.used).toBe(1);
    expect(block.multiTenant).toBe(true);
  });

  it('retryPeerApply re-aplica un peer apply_failed y lo deja applied al reintentar OK', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    let failNext = true;
    const applyCalls: unknown[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'GET' || String(url).endsWith('/health')) {
        return new Response(JSON.stringify({ ok: true, schemaVersion: 2, firewall: true }), { status: 200 });
      }
      applyCalls.push(1);
      if (failNext) { failNext = false; return new Response('down', { status: 503 }); }
      const body = JSON.parse(String(init?.body || '{}')) as { revision?: number };
      return new Response(JSON.stringify({ ok: true, peers: 1, revision: body.revision, digest: 'd' }), { status: 200 });
    }) as unknown as typeof fetch;

    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'h', isDefault: true });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' }); // primer apply falla
    expect(peer.peer.applyState).toBe('apply_failed');
    const retried = await svc.retryPeerApply(peer.peer.id);
    expect(retried?.applyState).toBe('applied');
  });

  it('v2 aborta el apply completo si un peer no tiene PSK cifrada', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    const { fetchMock } = installFetch();
    await expect(applyStateToHost({
      revision: 1,
      tenantSubnets: ['10.70.0.0/24'],
      peers: [{ id: 'p-no-psk', publicKey: 'pub', allocatedIp: '10.70.0.2', tenantSubnet: '10.70.0.0/24' }],
    })).rejects.toThrow(/PSK|preshared/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('v2 aborta el apply completo si falla el decrypt de una PSK', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    const { fetchMock } = installFetch();
    await expect(applyStateToHost({
      revision: 1,
      tenantSubnets: ['10.70.0.0/24'],
      peers: [{
        id: 'p-bad-psk', publicKey: 'pub', allocatedIp: '10.70.0.2',
        tenantSubnet: '10.70.0.0/24', encryptedPresharedKey: 'not-encrypted',
      }],
    })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callback de ACK recibe revisión, digest e IDs exactos del snapshot enviado', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch();
    let ack: { revision: number; digest?: string; peerIds: string[] } | undefined;
    configureHostApplyStateLoader(async () => ({
      revision: 7,
      tenantSubnets: ['10.70.0.0/24'],
      peers: [{
        id: 'p-snapshot', publicKey: 'pub', allocatedIp: '10.70.0.2',
        tenantSubnet: '10.70.0.0/24', encryptedPresharedKey: encryptSecret(generatePresharedKey()),
      }],
    }), async (_result, snapshot) => { ack = snapshot; });

    expect((await syncActivePeersToHost()).ok).toBe(true);
    expect(ack).toEqual({ revision: 7, digest: 'digest-x', peerIds: ['p-snapshot'] });
  });

  it('fallo al persistir el ACK se propaga como apply fallido', async () => {
    process.env.WIREGUARD_MULTITENANT = 'true';
    installFetch();
    configureHostApplyStateLoader(async () => ({
      revision: 8,
      tenantSubnets: ['10.70.0.0/24'],
      peers: [{
        id: 'p-ack-fail', publicKey: 'pub', allocatedIp: '10.70.0.2',
        tenantSubnet: '10.70.0.0/24', encryptedPresharedKey: encryptSecret(generatePresharedKey()),
      }],
    }), async () => { throw new Error('ack persistence failed'); });

    const result = await syncActivePeersToHost();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ack persistence failed');
  });

  it('el repositorio marca applied sólo los IDs incluidos en el ACK', async () => {
    const repo = new StoreWireguardRepository();
    const now = new Date().toISOString();
    repo.PEERS.push(
      { id: 'p-sent', serverId: 's', name: 'sent', publicKey: 'a', encryptionVersion: 'v1', allocatedIp: '10.70.0.2', status: 'active', applyState: 'pending_apply', createdAt: now, updatedAt: now },
      { id: 'p-later', serverId: 's', name: 'later', publicKey: 'b', encryptionVersion: 'v1', allocatedIp: '10.70.0.3', status: 'active', applyState: 'pending_apply', createdAt: now, updatedAt: now },
    );
    await repo.ackAppliedSnapshot(9, 'digest', ['p-sent']);
    expect(repo.PEERS.find((p) => p.id === 'p-sent')?.applyState).toBe('applied');
    expect(repo.PEERS.find((p) => p.id === 'p-later')?.applyState).toBe('pending_apply');
  });
});

describe('WireGuard multi-tenant — RBAC de mutación de servidor', () => {
  const SA = { 'x-user-role': 'super admin', 'x-user-id': 'sa' };
  const ADM = { 'x-user-role': 'administrador', 'x-user-id': 'adm' };
  const body = { name: 'VPN', endpointHost: 'vpn.local' };

  afterEach(() => {
    delete process.env.WIREGUARD_MULTITENANT;
    resetWireguardService();
  });

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

  it('flag apagado: endpoints v2 no existen y devuelven 404', async () => {
    delete process.env.WIREGUARD_MULTITENANT;
    const app = createApp();
    expect((await request(app).get('/api/wireguard/tenant-block').set(ADM)).status).toBe(404);
    expect((await request(app).post('/api/wireguard/peers/p-1/retry-apply').set(ADM)).status).toBe(404);
  });

  it('flag apagado: POST /peers conserva status 400 y cuerpo legacy sin code', async () => {
    delete process.env.WIREGUARD_MULTITENANT;
    const app = createApp();
    const res = await request(app).post('/api/wireguard/peers').set(ADM)
      .send({ serverId: 'missing', name: 'Router válido' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Servidor WireGuard 'missing' no encontrado." });
  });

  it('rechaza nombres multi-línea antes de persistirlos', async () => {
    const app = createApp();
    const server = await request(app).post('/api/wireguard/servers').set(SA)
      .send({ name: 'VPN', endpointHost: 'vpn.local' });
    const res = await request(app).post('/api/wireguard/peers').set(SA)
      .send({ serverId: server.body.server.id, name: 'Router\n[Peer]' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nombre|name|caracteres|línea/i);
    const peers = await request(app).get('/api/wireguard/peers').set(SA);
    expect(peers.body).toEqual([]);
  });
});
