import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Fase 4.6.1 — Contrato del WireGuard Manager (RBAC SA/Admin) + integración
// con provisioning. Los secretos se devuelven una vez; los listados no.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'wg-admin' };
const TEC = { 'x-user-role': 'tecnico', 'x-user-id': 'wg-tec' };
const COBR = { 'x-user-role': 'cobranza', 'x-user-id': 'wg-cobr' };

describe('WireGuard Manager — RBAC', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('SA/Admin/Técnico pueden listar servers; cobranza → 403', async () => {
    // Técnico necesita leer servers/peers para generar scripts .rsc
    expect((await request(app).get('/api/wireguard/servers').set(ADMIN)).status).toBe(200);
    expect((await request(app).get('/api/wireguard/servers').set(TEC)).status).toBe(200);
    expect((await request(app).get('/api/wireguard/servers').set(COBR)).status).toBe(403);
  });

  it('técnico NO puede crear servidores ni peers → 403', async () => {
    expect((await request(app).post('/api/wireguard/servers').set(TEC).send({ name: 'x', endpointHost: 'x' })).status).toBe(403);
    expect((await request(app).post('/api/wireguard/peers').set(TEC).send({ serverId: 'x', name: 'x' })).status).toBe(403);
  });
});

describe('WireGuard Manager — servidores y peers', () => {
  let app: Express;
  let serverId = '';
  let peerId = '';
  beforeAll(() => { app = createApp(); });

  it('crea servidor → public key + private key una sola vez', async () => {
    const res = await request(app).post('/api/wireguard/servers').set(ADMIN).send({ name: 'VPN CDMX', endpointHost: 'vpn.nugacore.local', endpointPort: 13231 });
    expect(res.status).toBe(201);
    expect(res.body.server.publicKey).toBeTruthy();
    expect(res.body.serverPrivateKey).toBeTruthy();
    expect(res.body.server).not.toHaveProperty('encryptedPrivateKey');
    serverId = res.body.server.id;
  });

  it('servidor requiere name + endpointHost', async () => {
    expect((await request(app).post('/api/wireguard/servers').set(ADMIN).send({ name: 'x' })).status).toBe(400);
  });

  it('crea peer → IP asignada + secretos una vez', async () => {
    const res = await request(app).post('/api/wireguard/peers').set(ADMIN).send({ serverId, name: 'Router 1', routerId: 'mkt-1' });
    expect(res.status).toBe(201);
    expect(res.body.assignedIp).toMatch(/\/32$/);
    expect(res.body.privateKey).toBeTruthy();
    expect(res.body.presharedKey).toBeTruthy();
    peerId = res.body.peer.id;
  });

  it('la lista de peers NO expone secretos', async () => {
    const res = await request(app).get('/api/wireguard/peers').set(ADMIN);
    expect(res.status).toBe(200);
    const p = res.body.find((x: any) => x.id === peerId);
    expect(p).toBeTruthy();
    expect(p).not.toHaveProperty('privateKey');
    expect(p).not.toHaveProperty('presharedKey');
    expect(p).not.toHaveProperty('encryptedPrivateKey');
    expect(p.hasSecrets).toBe(true);
  });

  it('rota el peer → nuevas claves', async () => {
    const res = await request(app).post(`/api/wireguard/peers/${peerId}/rotate`).set(ADMIN).send({});
    expect(res.status).toBe(201);
    expect(res.body.privateKey).toBeTruthy();
  });

  it('revoca el peer', async () => {
    const res = await request(app).delete(`/api/wireguard/peers/${peerId}`).set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
  });
});

describe('WireGuard Manager — integración con provisioning', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('wireguard_managed + wireguardServerId → script con private-key e IP asignada', async () => {
    const srv = await request(app).post('/api/wireguard/servers').set(ADMIN).send({ name: 'VPN Int', endpointHost: 'vpn.int.local', endpointPort: 51820 });
    const serverId = srv.body.server.id;

    const router = await request(app).post('/api/mikrotik/routers').set(ADMIN).send({ name: 'Int Router', managementIp: '10.5.5.5', connectionType: 'wireguard' });
    const routerId = router.body.id;

    const res = await request(app).post(`/api/mikrotik/routers/${routerId}/provisioning-script`).set(ADMIN).send({ connectionType: 'wireguard_managed', wireguardServerId: serverId });
    expect(res.status).toBe(201);
    expect(res.body.wireguard).toBeTruthy();
    expect(res.body.wireguard.managed).toBe(true);
    expect(res.body.wireguard.assignedIp).toMatch(/\/32$/);

    // El script incrusta la private-key del router y la IP asignada.
    expect(res.body.script).toContain('private-key="');
    expect(res.body.script).toContain(res.body.wireguard.assignedIp);

    // El secreto va SOLO dentro del script, no como campo suelto.
    expect(res.body).not.toHaveProperty('privateKey');
    expect(res.body.credentials).not.toHaveProperty('privateKey');
  });
});
