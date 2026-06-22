import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const READ = { 'x-user-role': 'tecnico', 'x-user-id': 'coverage-reader' };

describe('GET /api/coverage/check', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('devuelve distancia, azimut, cobertura y status', async () => {
    const response = await request(app)
      .get('/api/coverage/check')
      .query({
        routerId: 'rb5009-main',
        latitude: 19.4,
        longitude: -99.17,
      })
      .set(READ);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      distanceKm: expect.any(Number),
      azimuth: expect.any(Number),
      estimatedCoverage: expect.any(Number),
      status: expect.stringMatching(/^(GOOD|WARNING|POOR)$/),
    });
  });

  it('valida parámetros y rangos GPS', async () => {
    await request(app)
      .get('/api/coverage/check')
      .query({ routerId: 'rb5009-main' })
      .set(READ)
      .expect(400);
    const invalid = await request(app)
      .get('/api/coverage/check')
      .query({ routerId: 'rb5009-main', latitude: 91, longitude: 0 })
      .set(READ);
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('COVERAGE_COORDINATES_INVALID');
  });
});
