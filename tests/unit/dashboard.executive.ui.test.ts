import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Dashboard Ejecutivo — contrato UI profesional (sin cabina duplicada).
// ====================================================================

const dash = readFileSync('src/components/Dashboard.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

describe('Dashboard — 8 KPIs ejecutivos', () => {
  it('define exactamente 8 KPIs', () => {
    const count = (dash.match(/id: 'kpi-/g) || []).length;
    expect(count).toBe(8);
  });

  it('muestra KPIs de negocio y red operativa', () => {
    for (const label of [
      'Clientes activos',
      'Suspendidos',
      'MRR',
      'Cobrado del mes',
      'Tickets abiertos',
      'Equipos en línea',
      'Facturas vencidas',
      'Zonas con incidencia',
    ]) {
      expect(dash, `falta KPI "${label}"`).toContain(label);
    }
  });

  it('no muestra KPIs operativos ruidosos', () => {
    for (const ghost of ['Provisioning Pendiente', 'Automation Queue', 'Notificaciones Pendientes', 'Torres Online', 'Capacidad Promedio']) {
      expect(dash, `KPI ruidoso presente: ${ghost}`).not.toContain(ghost);
    }
  });
});

describe('Dashboard — sin cabina de mando', () => {
  it('elimina la sección Cabina de Mando WISP OS', () => {
    expect(dash).not.toContain('Cabina de Mando');
    expect(dash).not.toContain('dashboard-control-center');
    expect(dash).not.toContain('/api/dashboard/control-center');
  });
});

describe('Dashboard — estado por zona', () => {
  it('renderiza estado por zona con equipos', () => {
    expect(dash).toContain('id="dashboard-zone-status"');
    expect(dash).toContain('Estado por zona');
    expect(dash).toContain('/api/dashboard/zones');
    expect(dash).toContain('ROLE_LABEL');
    expect(dash).toContain('Router');
    expect(dash).toContain('Radio/AP');
  });
});

describe('Dashboard — navegación', () => {
  const NAV: Array<[string, string]> = [
    ['kpi-clientes-activos', 'crm'],
    ['kpi-equipos', 'noc'],
    ['kpi-zonas', 'noc'],
    ['qa-abrir-noc', 'noc'],
  ];

  for (const [id, tab] of NAV) {
    it(`${id} navega a "${tab}"`, () => {
      const re = new RegExp(`id: '${id}'[^\\n]*tab: '${tab}'`);
      expect(re.test(dash), `${id} debe navegar a ${tab}`).toBe(true);
    });
  }

  it('App pasa onNavigate al Dashboard', () => {
    expect(app).toContain('onNavigate={navigateToTab}');
  });
});

describe('Dashboard — alertas y acciones', () => {
  it('limita alertas a 5', () => {
    expect(dash).toContain('.slice(0, 5)');
  });

  it('mantiene 5 acciones rápidas', () => {
    expect((dash.match(/id: 'qa-/g) || []).length).toBe(5);
  });
});

describe('Dashboard — layout', () => {
  it('KPIs en grilla 4 columnas', () => {
    expect(dash).toContain('grid-cols-2 lg:grid-cols-4');
  });
});
