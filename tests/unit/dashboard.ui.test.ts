import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Dashboard operativo — contrato de UI (resumen priorizado, sin tema nuevo).
// Verifica que el dashboard muestra un resumen operativo arriba, con estado de
// red + alertas primero y KPIs clave enlazables, usando datos ya disponibles.
// ====================================================================

const dashboardSource = readFileSync('src/components/Dashboard.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('Dashboard — resumen operativo', () => {
  it('renderiza la sección de resumen operativo', () => {
    expect(dashboardSource).toContain('id="dashboard-operativo"');
    expect(dashboardSource).toContain('Resumen operativo');
  });

  it('prioriza estado de red y alertas NOC', () => {
    expect(dashboardSource).toContain('Estado general de la red');
    expect(dashboardSource).toContain('alertas NOC');
  });

  it('muestra los KPIs operativos clave', () => {
    for (const label of [
      'Suscriptores activos',
      'Suspendidos',
      'Tickets abiertos',
      'Pendiente de cobro',
      'Ingresos del mes',
    ]) {
      expect(dashboardSource, `falta el KPI "${label}"`).toContain(label);
    }
  });

  it('deriva indicadores de datos existentes (stats/alerts), sin integraciones nuevas', () => {
    expect(dashboardSource).toContain('stats.activeClients');
    expect(dashboardSource).toContain('stats.suspendedClients');
    expect(dashboardSource).toContain('stats.activeTickets');
    // Pendiente de cobro derivado de facturación - cobranza.
    expect(dashboardSource).toContain('facturacionMes');
    expect(dashboardSource).toContain('cobranzaMes');
  });

  it('permite enlazar a módulos vía onNavigate (detalle por módulo)', () => {
    expect(dashboardSource).toContain('onNavigate');
    // App pasa la navegación real (setActiveTab) al Dashboard.
    expect(appSource).toContain('onNavigate={setActiveTab}');
  });

  it('no introduce un tema nuevo: conserva la paleta slate/indigo existente', () => {
    expect(dashboardSource).toContain('bg-slate-950');
    expect(dashboardSource).toContain('border-slate-800');
  });
});
