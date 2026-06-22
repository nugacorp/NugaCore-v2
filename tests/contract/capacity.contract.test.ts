import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const READ = { 'x-user-role': 'soporte', 'x-user-id': 'capacity-reader' };

describe('GET /api/ipam/routers/:routerId/capacity', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('devuelve el contrato de capacidad mock', async () => {
    const response = await request(app)
      .get('/api/ipam/routers/rb5009-main/capacity')
      .set(READ);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      routerId: 'rb5009-main',
      routerName: 'RB5009 Principal',
      totalCapacity: 128,
      activeClients: expect.any(Number),
      freeCapacity: expect.any(Number),
      utilizationPercent: expect.any(Number),
    });
    expect(response.body.activeClients + response.body.freeCapacity).toBe(128);
  });

  it('devuelve 404 para router inexistente', async () => {
    const response = await request(app)
      .get('/api/ipam/routers/missing/capacity')
      .set(READ);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('IPAM_ROUTER_NOT_FOUND');
  });
});
