import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Dashboard Ejecutivo — contrato de UI (profesional, sin cabina).
// ====================================================================

const dashboardSource = readFileSync('src/components/Dashboard.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('Dashboard — estructura ejecutiva V3', () => {
  it('renderiza las secciones núcleo (KPIs, zonas, alertas, acciones)', () => {
    expect(dashboardSource).toContain('id="dashboard-executive-kpis"');
    expect(dashboardSource).toContain('id="dashboard-zone-status"');
    expect(dashboardSource).toContain('id="dashboard-important-alerts"');
    expect(dashboardSource).toContain('id="dashboard-quick-actions"');
  });

  it('deriva indicadores de billing y zonas', () => {
    expect(dashboardSource).toContain('stats.activeClients');
    expect(dashboardSource).toContain('/api/dashboard/billing-kpis');
    expect(dashboardSource).toContain('/api/dashboard/zones');
  });

  it('permite enlazar a módulos vía onNavigate (cada KPI/alerta/acción)', () => {
    expect(dashboardSource).toContain('onNavigate');
    expect(appSource).toContain('onNavigate={navigateToTab}');
  });

  it('no introduce un tema nuevo: conserva la paleta slate/indigo existente', () => {
    expect(dashboardSource).toContain('bg-slate-950');
    expect(dashboardSource).toContain('border-slate-800');
  });
});
