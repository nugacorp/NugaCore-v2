import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPeersToHost,
  isHostApplyEnabled,
  resetHostApplyStateForTests,
} from '../../backend/domains/wireguard/host-apply';
import { WireguardService } from '../../backend/domains/wireguard/service';
import { StoreWireguardRepository } from '../../backend/domains/wireguard/repository';

describe('WireGuard host-apply', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetHostApplyStateForTests();
    delete process.env.WIREGUARD_HOST_APPLY_URL;
    delete process.env.WIREGUARD_HOST_APPLY_TOKEN;
    delete process.env.WIREGUARD_HOST_APPLY_ENABLED;
  });

  afterEach(() => {
    resetHostApplyStateForTests();
    globalThis.fetch = originalFetch;
    delete process.env.WIREGUARD_HOST_APPLY_URL;
    delete process.env.WIREGUARD_HOST_APPLY_TOKEN;
    delete process.env.WIREGUARD_HOST_APPLY_ENABLED;
  });

  it('está deshabilitado sin URL', () => {
    expect(isHostApplyEnabled()).toBe(false);
  });

  it('aplica peers al agente con Bearer token', async () => {
    process.env.WIREGUARD_HOST_APPLY_URL = 'http://127.0.0.1:18765/apply';
    process.env.WIREGUARD_HOST_APPLY_TOKEN = 'test-token';
    expect(isHostApplyEnabled()).toBe(true);

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as {
        peers: Array<{ publicKey: string; allocatedIp: string }>;
      };
      expect(body.peers).toHaveLength(1);
      expect(body.peers[0].allocatedIp).toBe('10.70.0.2');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
      return new Response(JSON.stringify({ ok: true, peers: 1 }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await applyPeersToHost([
      {
        publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        allocatedIp: '10.70.0.2/32',
        name: 'r1',
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.peersApplied).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('createPeer dispara host-apply con el peer activo', async () => {
    process.env.WIREGUARD_HOST_APPLY_URL = 'http://127.0.0.1:18765/apply';
    process.env.WIREGUARD_HOST_APPLY_TOKEN = 't';

    const calls: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body || '{}')));
      return new Response(JSON.stringify({ ok: true, peers: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const svc = new WireguardService(new StoreWireguardRepository());
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'vpn.local' });
    await svc.createPeer({ serverId: srv.server.id, name: 'R1', routerId: 'mkt-1' });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls[calls.length - 1] as { peers: Array<{ allocatedIp: string }> };
    expect(last.peers).toHaveLength(1);
    expect(last.peers[0].allocatedIp).toBe('10.70.0.2');
  });

  it('revokePeer re-aplica sin el peer revocado (anti claves viejas)', async () => {
    process.env.WIREGUARD_HOST_APPLY_URL = 'http://127.0.0.1:18765/apply';
    process.env.WIREGUARD_HOST_APPLY_TOKEN = 't';

    const payloads: Array<{ peers: unknown[] }> = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body || '{}')) as { peers: unknown[] });
      return new Response(JSON.stringify({ ok: true, peers: 0 }), { status: 200 });
    }) as unknown as typeof fetch;

    const svc = new WireguardService(new StoreWireguardRepository());
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'vpn.local' });
    const p1 = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    await svc.createPeer({ serverId: srv.server.id, name: 'R2' });
    await svc.revokePeer(p1.peer.id);

    const last = payloads[payloads.length - 1];
    expect(last.peers).toHaveLength(1);
  });

  it('no rompe createPeer si el agente falla', async () => {
    process.env.WIREGUARD_HOST_APPLY_URL = 'http://127.0.0.1:18765/apply';
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as unknown as typeof fetch;

    const svc = new WireguardService(new StoreWireguardRepository());
    const srv = await svc.createServer({ name: 'VPN', endpointHost: 'vpn.local' });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    expect(peer.peer.id).toBeTruthy();
  });
});
