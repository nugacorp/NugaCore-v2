import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';

// ====================================================================
// Contrato de KPIs ejecutivos de cobranza (FASE E — Billing Foundation).
//   GET /api/dashboard/billing-kpis  (read-only, vía BillingService).
// Modo hermético (store mock).
// ====================================================================

const READER = { 'x-user-role': 'solo lectura', 'x-user-id': 'test-reader' };

describe('API v1 — Dashboard Billing KPIs', () => {
  let app: Express;
  beforeAll(() => { app = createApp(); });

  it('GET /api/dashboard/billing-kpis → forma de KPIs ejecutivos', async () => {
    const res = await request(app).get('/api/dashboard/billing-kpis').set(READER);
    expect(res.status).toBe(200);
    for (const key of ['generatedAt', 'month', 'facturacionMes', 'cobradoMes', 'pendienteCobro', 'clientesConAdeudo', 'facturasVencidas', 'topAdeudos']) {
      expect(res.body, `falta "${key}"`).toHaveProperty(key);
    }
    expect(Array.isArray(res.body.topAdeudos)).toBe(true);
    expect(res.body.topAdeudos.length).toBeLessThanOrEqual(10);
  });

  it('los montos son numéricos no negativos y reflejan adeudos del seed', async () => {
    const res = await request(app).get('/api/dashboard/billing-kpis').set(READER);
    expect(typeof res.body.pendienteCobro).toBe('number');
    expect(res.body.pendienteCobro).toBeGreaterThan(0); // fac-103 + fac-105 pendientes
    expect(res.body.clientesConAdeudo).toBeGreaterThan(0);
    expect(res.body.facturasVencidas).toBeGreaterThan(0);
    if (res.body.topAdeudos.length > 0) {
      for (const key of ['invoiceId', 'clientId', 'clientName', 'pendingAmount', 'dueDateStr', 'status']) {
        expect(res.body.topAdeudos[0], `falta "${key}"`).toHaveProperty(key);
      }
      // Ordenado descendente por pendingAmount.
      const amounts = res.body.topAdeudos.map((r: { pendingAmount: number }) => r.pendingAmount);
      const sorted = [...amounts].sort((a, b) => b - a);
      expect(amounts).toEqual(sorted);
    }
  });
});
