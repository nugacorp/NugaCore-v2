import { describe, it, expect } from 'vitest';
import { WireguardService } from '../../backend/domains/wireguard/service';
import { StoreWireguardRepository } from '../../backend/domains/wireguard/repository';
import { isWgKey } from '../../backend/domains/wireguard/keys';

// ====================================================================
// Fase 4.6.1 — WireguardService: servidores, peers, rotación, revocación,
// IPAM (reuso) e integración con provisioning.
// ====================================================================

const newService = () => new WireguardService(new StoreWireguardRepository());

describe('WireguardService', () => {
  it('crea servidor y devuelve la private key una sola vez (no en la vista)', async () => {
    const svc = newService();
    const res = await svc.createServer({ name: 'VPN1', endpointHost: 'vpn.nugacore.local' });
    expect(isWgKey(res.server.publicKey)).toBe(true);
    expect(isWgKey(res.serverPrivateKey)).toBe(true);
    expect((res.server as any).serverPrivateKey).toBeUndefined();
    expect((res.server as any).encryptedPrivateKey).toBeUndefined();
  });

  it('crea peer: IP /32 asignada + secretos una vez; la lista no expone secretos', async () => {
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN1', endpointHost: 'vpn.nugacore.local' });
    const peer = await svc.createPeer({ serverId: srv.server.id, name: 'R1', routerId: 'mkt-1' });
    expect(peer.assignedIp).toMatch(/^10\.70\.\d+\.\d+\/32$/);
    expect(isWgKey(peer.privateKey)).toBe(true);
    expect(isWgKey(peer.presharedKey)).toBe(true);
    expect(peer.serverPublicKey).toBe(srv.server.publicKey);

    const list = await svc.listPeers();
    expect(list.length).toBe(1);
    expect((list[0] as any).privateKey).toBeUndefined();
    expect((list[0] as any).presharedKey).toBeUndefined();
    expect(list[0].hasSecrets).toBe(true);
  });

  it('asigna IPs distintas a peers distintos', async () => {
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN1', endpointHost: 'h' });
    const p1 = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    const p2 = await svc.createPeer({ serverId: srv.server.id, name: 'R2' });
    expect(p1.assignedIp).not.toBe(p2.assignedIp);
  });

  it('rota claves: nueva private key + registro de rotación', async () => {
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN1', endpointHost: 'h' });
    const p = await svc.createPeer({ serverId: srv.server.id, name: 'R1' });
    const rot = await svc.rotatePeer(p.peer.id, 'tester', 'test');
    expect(rot).toBeTruthy();
    expect(rot!.privateKey).not.toBe(p.privateKey);
    expect(rot!.peer.publicKey).not.toBe(p.peer.publicKey);
    expect((await svc.listRotations(p.peer.id)).length).toBe(1);
  });

  it('revoca peer y reutiliza su IP en el siguiente peer', async () => {
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN1', endpointHost: 'h' });
    const p1 = await svc.createPeer({ serverId: srv.server.id, name: 'R1' }); // .2
    await svc.createPeer({ serverId: srv.server.id, name: 'R2' });           // .3
    await svc.revokePeer(p1.peer.id);                                        // libera .2
    const p3 = await svc.createPeer({ serverId: srv.server.id, name: 'R3' });
    expect(p3.assignedIp).toBe(p1.assignedIp); // reusa la .2
  });

  it('getPeerConfigForRouter: crea si no existe y reusa el mismo peer luego', async () => {
    const svc = newService();
    const srv = await svc.createServer({ name: 'VPN1', endpointHost: 'h' });
    const first = await svc.getPeerConfigForRouter('mkt-9', srv.server.id);
    const second = await svc.getPeerConfigForRouter('mkt-9', srv.server.id);
    expect(second.peer.id).toBe(first.peer.id);
    expect(isWgKey(second.privateKey)).toBe(true); // descifrado para re-provisioning
  });
});
