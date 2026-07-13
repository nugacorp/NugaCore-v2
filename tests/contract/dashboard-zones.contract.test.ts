import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('API — Dashboard zones', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/dashboard/zones -> zonas con equipos', async () => {
    const res = await request(app).get('/api/dashboard/zones').set(READER);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('zones');
    expect(Array.isArray(res.body.zones)).toBe(true);
    if (res.body.zones.length > 0) {
      const zone = res.body.zones[0];
      expect(zone).toHaveProperty('zoneName');
      expect(zone).toHaveProperty('equipment');
      expect(Array.isArray(zone.equipment)).toBe(true);
    }
  });
});
