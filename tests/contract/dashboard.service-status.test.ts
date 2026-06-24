import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../backend/app';
import { serviceStatusStore } from '../../backend/domains/service-status/store';

// ====================================================================
// Dashboard × Service Status (Pre-PROD-7). El KPI "Suspendidos" del
// dashboard debe consumir Service Status (no el customerStatus del CRM).
// Sin cambios de diseño visual: solo fuente de datos.
// ====================================================================

const ADMIN = { 'x-user-role': 'super admin', 'x-user-id': 'test-admin' };

describe('Dashboard — KPI Suspendidos desde Service Status', () => {
  it('buildDashboardStats toma suspendedClients de serviceStatus, no del CRM', () => {
    const src = readFileSync('backend/domains/dashboard/routes.ts', 'utf8');
    expect(src).toContain('suspendedClients: snapshot.serviceStatus.suspended');
    expect(src).not.toContain('suspendedClients: snapshot.customers.suspended');
  });

  describe('contrato', () => {
    let app: Express;
    beforeAll(() => { app = createApp(); });
    beforeEach(() => serviceStatusStore.reset());

    it('dashboard-stats.suspendedClients == service-status/summary SUSPENDED', async () => {
      const [stats, summary] = await Promise.all([
        request(app).get('/api/dashboard-stats').set(ADMIN),
        request(app).get('/api/service-status/summary').set(ADMIN),
      ]);
      expect(stats.status).toBe(200);
      expect(summary.status).toBe(200);
      expect(stats.body.suspendedClients).toBe(summary.body.byStatus.SUSPENDED);
    });
  });
});
