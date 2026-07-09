import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// C-02 — RBAC en endpoints GIS.
//   Las rutas de datos GIS (map-data, customers, towers, layers) exponen
//   PII de clientes y topología: requieren un rol de lectura autenticado.
//   El healthcheck permanece público.
//
// Nota: en modo hermético los trusted-headers asignan un rol; por eso aquí
// verificamos que TODOS los roles de lectura pasan (el guard está bien
// cableado y no bloquea a usuarios legítimos) y que /health sigue abierto.
// La propiedad "sin JWT => 401" en un despliegue real la cubre la suite de
// auth (NODE_ENV=production).
// ====================================================================

const role = (r: string) => ({ 'x-user-role': r, 'x-user-id': `u-${r}` });
const READ_ROLES = ['super admin', 'administrador', 'cobranza', 'tecnico', 'soporte', 'solo lectura'];
const DATA_ROUTES = ['/api/gis/layers', '/api/gis/map-data', '/api/gis/customers', '/api/gis/towers'];

describe('GIS — RBAC', () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it('el healthcheck es público', async () => {
    const res = await request(app).get('/api/gis/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('todos los roles de lectura acceden a las rutas de datos (200)', async () => {
    for (const r of READ_ROLES) {
      for (const route of DATA_ROUTES) {
        const res = await request(app).get(route).set(role(r));
        expect(res.status, `${route} para ${r}`).toBe(200);
      }
    }
  });
});
