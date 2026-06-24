import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Dashboard Ejecutivo — contrato de UI (V3, desaturado).
// El dashboard es una pantalla de decisión rápida: 8 KPIs clickeables,
// alertas importantes y acciones rápidas. La validación detallada vive en
// dashboard.executive.ui.test.ts; aquí se cubren los invariantes base y la
// preservación del tema (sin tema nuevo).
// ====================================================================

const dashboardSource = readFileSync('src/components/Dashboard.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('Dashboard — estructura ejecutiva V3', () => {
  it('renderiza las tres secciones núcleo (KPIs, alertas, acciones)', () => {
    expect(dashboardSource).toContain('id="dashboard-executive-kpis"');
    expect(dashboardSource).toContain('id="dashboard-important-alerts"');
    expect(dashboardSource).toContain('id="dashboard-quick-actions"');
  });

  it('deriva indicadores de datos existentes (stats/alerts/billingKpis), sin integraciones nuevas', () => {
    expect(dashboardSource).toContain('stats.activeClients');
    expect(dashboardSource).toContain('stats.suspendedClients');
    expect(dashboardSource).toContain('stats.activeTickets');
    expect(dashboardSource).toContain('/api/dashboard/billing-kpis');
  });

  it('permite enlazar a módulos vía onNavigate (cada KPI/alerta/acción)', () => {
    expect(dashboardSource).toContain('onNavigate');
    expect(appSource).toContain('onNavigate={setActiveTab}');
  });

  it('no introduce un tema nuevo: conserva la paleta slate/indigo existente', () => {
    expect(dashboardSource).toContain('bg-slate-950');
    expect(dashboardSource).toContain('border-slate-800');
  });
});
