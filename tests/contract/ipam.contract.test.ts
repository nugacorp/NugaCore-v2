import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const READ = { 'x-user-role': 'soporte', 'x-user-id': 'ipam-contract-reader' };

describe('IPAM API — local/mock, sin RouterOS', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /api/ipam/routers lista routers y torres disponibles', async () => {
    const response = await request(app).get('/api/ipam/routers').set(READ);
    expect(response.status).toBe(200);
    expect(response.body.map((router: { id: string }) => router.id)).toEqual(
      expect.arrayContaining(['rb5009-main', 'tower-san-ramon']),
    );
  });

  it('GET /api/ipam/routers/:routerId/pools lista segmentos conocidos', async () => {
    const response = await request(app)
      .get('/api/ipam/routers/rb5009-main/pools')
      .set(READ);
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      id: 'pool-rb5009-main-100',
      cidr: '192.168.100.0/24',
    });
  });

  it('GET /api/ipam/pools/:poolId/available-ips calcula libres', async () => {
    const response = await request(app)
      .get('/api/ipam/pools/pool-rb5009-main-100/available-ips')
      .set(READ);
    expect(response.status).toBe(200);
    expect(response.body.source).toBe('mock-local');
    expect(response.body.ips).toContain('192.168.100.3');
    expect(response.body.ips).not.toContain('192.168.100.10');
  });

  it('POST /api/ipam/validate-ip valida sin tocar RouterOS', async () => {
    const response = await request(app)
      .post('/api/ipam/validate-ip')
      .set(READ)
      .send({
        routerId: 'rb5009-main',
        poolId: 'pool-rb5009-main-100',
        ip: '192.168.100.25',
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'available', available: true });
  });

  it('el alta con asignación IPAM válida conserva el payload de red', async () => {
    const response = await request(app)
      .post('/api/clients')
      .set({ 'x-user-role': 'super admin', 'x-user-id': 'ipam-contract-admin' })
      .send({
        name: 'Cliente IPAM Contract',
        type: 'residential',
        address: 'Calle IPAM 25',
        city: 'CDMX',
        planId: 'plan-basic',
        routerId: 'rb5009-main',
        poolId: 'pool-rb5009-main-100',
        assignedIp: '192.168.100.25',
        ipAssignmentStatus: 'available',
      });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      routerId: 'rb5009-main',
      poolId: 'pool-rb5009-main-100',
      assignedIp: '192.168.100.25',
      ip: '192.168.100.25',
      ipAssignmentStatus: 'available',
    });
    await request(app)
      .delete(`/api/clients/${response.body.id}`)
      .set({ 'x-user-role': 'super admin', 'x-user-id': 'ipam-contract-admin' })
      .expect(204);
  });

  it('el alta bloquea una IP ocupada aunque el frontend diga disponible', async () => {
    const response = await request(app)
      .post('/api/clients')
      .set({ 'x-user-role': 'super admin', 'x-user-id': 'ipam-contract-admin' })
      .send({
        name: 'Cliente IPAM Duplicado',
        type: 'residential',
        address: 'Calle IPAM 10',
        city: 'CDMX',
        planId: 'plan-basic',
        routerId: 'rb5009-main',
        poolId: 'pool-rb5009-main-100',
        assignedIp: '192.168.100.10',
        ipAssignmentStatus: 'available',
      });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('IPAM_IN_USE');
  });
});
