import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const READ = { 'x-user-role': 'soporte', 'x-user-id': 'preventa-agent' };

// NAP-01 del store demo: 19.4285 / -99.1655, 3 puertos libres de 8.
const NEAR_NAP_01 = { lat: 19.4287, lng: -99.1655 };

describe('GET /api/ftth/feasibility', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('devuelve la NAP más cercana con puerto libre y la distancia de drop', async () => {
    const response = await request(app)
      .get('/api/ftth/feasibility')
      .query(NEAR_NAP_01)
      .set(READ);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      eligible: true,
      reason: 'ELIGIBLE',
      searchRadiusMeters: 250,
    });
    expect(response.body.best).toMatchObject({
      napId: 'NAP-01',
      freePorts: 3,
      totalPorts: 8,
      splitRatio: '1:8',
      hasFreePort: true,
    });
    expect(response.body.best.distanceMeters).toBeLessThan(60);
    expect(Array.isArray(response.body.candidates)).toBe(true);
  });

  it('reporta zona sin infraestructura sin romper', async () => {
    const response = await request(app)
      .get('/api/ftth/feasibility')
      .query({ lat: -33.45, lng: -70.66 })
      .set(READ);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      eligible: false,
      reason: 'NO_NAP_IN_RANGE',
      best: null,
    });
  });

  it('acepta un radio de drop personalizado', async () => {
    const response = await request(app)
      .get('/api/ftth/feasibility')
      .query({ ...NEAR_NAP_01, maxDropMeters: 600 })
      .set(READ);

    expect(response.status).toBe(200);
    expect(response.body.searchRadiusMeters).toBe(600);
  });

  it('valida coordenadas y radio', async () => {
    await request(app).get('/api/ftth/feasibility').set(READ).expect(400);

    const outOfRange = await request(app)
      .get('/api/ftth/feasibility')
      .query({ lat: 91, lng: 0 })
      .set(READ);
    expect(outOfRange.status).toBe(400);
    expect(outOfRange.body.code).toBe('COVERAGE_COORDINATES_INVALID');

    const badRadius = await request(app)
      .get('/api/ftth/feasibility')
      .query({ ...NEAR_NAP_01, maxDropMeters: -10 })
      .set(READ);
    expect(badRadius.status).toBe(400);
    expect(badRadius.body.code).toBe('FEASIBILITY_INPUT_INVALID');
  });

  // En modo hermético los trusted-headers asignan rol; la propiedad
  // "sin JWT => 401" la cubre la suite de auth (NODE_ENV=production).
  it('todos los roles de lectura pueden consultar factibilidad', async () => {
    const roles = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'];
    for (const role of roles) {
      const res = await request(app)
        .get('/api/ftth/feasibility')
        .query(NEAR_NAP_01)
        .set({ 'x-user-role': role, 'x-user-id': `u-${role}` });
      expect(res.status, `factibilidad para ${role}`).toBe(200);
    }
  });
});
