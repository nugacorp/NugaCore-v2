import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Contrato — Data Consistency (Pre-PROD-7).
//
// Hermético (sin Supabase). Verifica, sobre la app real, que los KPIs
// publicados por los distintos endpoints provienen de una sola fuente
// oficial y coinciden entre sí:
//   - /api/system/data-consistency reporta healthy:true.
//   - dashboard-stats y billing-kpis concuerdan en cobranza/facturación.
//   - clientes activos del dashboard == conteo del CRM (/api/clients).
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

describe('Data consistency — contrato cross-módulo', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('GET /api/system/data-consistency -> reporte healthy con la forma esperada', async () => {
    const res = await request(app).get('/api/system/data-consistency').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('healthy');
    expect(res.body).toHaveProperty('checkedAt');
    expect(res.body).toHaveProperty('modules');
    expect(res.body).toHaveProperty('mismatches');
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.healthy).toBe(true);
    expect(res.body.mismatches).toEqual([]);
    expect(res.body.checks.every((c: { consistent: boolean }) => c.consistent)).toBe(true);
  });

  it('cobranza y facturación del mes coinciden entre dashboard-stats y billing-kpis', async () => {
    const [stats, billing] = await Promise.all([
      request(app).get('/api/dashboard-stats').set(ADMIN),
      request(app).get('/api/dashboard/billing-kpis').set(ADMIN),
    ]);
    expect(stats.status).toBe(200);
    expect(billing.status).toBe(200);

    // El bug histórico: dashboard sumaba TODO el histórico; billing-kpis el mes.
    // Tras la normalización deben ser idénticos (misma fuente: Billing).
    expect(stats.body.cobranzaMes).toBe(billing.body.cobradoMes);
    expect(stats.body.facturacionMes).toBe(billing.body.facturacionMes);
  });

  it('clientes activos del dashboard == conteo oficial del CRM', async () => {
    const [stats, activeClients] = await Promise.all([
      request(app).get('/api/dashboard-stats').set(ADMIN),
      request(app).get('/api/clients?status=active').set(ADMIN),
    ]);
    expect(stats.status).toBe(200);
    expect(activeClients.status).toBe(200);
    expect(Array.isArray(activeClients.body)).toBe(true);
    expect(stats.body.activeClients).toBe(activeClients.body.length);
  });

  it('MRR del dashboard == MRR del resumen ejecutivo (sin recálculos divergentes)', async () => {
    const [stats, summary] = await Promise.all([
      request(app).get('/api/dashboard-stats').set(ADMIN),
      request(app).get('/api/dashboard/executive-summary').set(ADMIN),
    ]);
    expect(stats.status).toBe(200);
    expect(summary.status).toBe(200);
    expect(stats.body.mrr).toBe(summary.body.kpis.revenue.mrr);
  });
});
