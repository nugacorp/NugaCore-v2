import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Dashboard Ejecutivo V3 — contrato de UI (desaturación y enfoque).
//
// Valida la pantalla de decisión rápida del dueño: KPIs principales
// clickeables, sin widgets duplicados, navegación correcta, máximo 5 alertas
// importantes, 5 acciones rápidas y layout responsive. El tooling NOC quedó
// movido a NocOperationsPanel. Sin tema nuevo (slate/indigo).
// ====================================================================

const dash = readFileSync('src/components/Dashboard.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

describe('Dashboard V3 — 11 KPIs principales', () => {
  it('define exactamente 11 KPIs', () => {
    const count = (dash.match(/id: 'kpi-/g) || []).length;
    expect(count).toBe(11);
  });

  it('muestra los 11 KPIs solicitados (fila 1 + fila 2 + automation + notifications)', () => {
    for (const label of [
      'Clientes Activos',
      'Suspendidos',
      'MRR',
      'Cobranza del Mes',
      'Tickets Abiertos',
      'Torres Online',
      'Capacidad Promedio',
      'Facturas Vencidas',
      'Provisioning Pendiente',
      'Automation Queue',
      'Notificaciones Pendientes',
    ]) {
      expect(dash, `falta KPI "${label}"`).toContain(label);
    }
  });

  it('cada KPI es clickeable (botón con onClick=go(tab))', () => {
    expect(dash).toContain('const go = (tab: string) => () => onNavigate?.(tab);');
    expect(dash).toContain('onClick={go(kpi.tab)}');
    expect(dash).toContain('id={kpi.id}');
  });
});

describe('Dashboard V3 — navegación por KPI (FASE G)', () => {
  const NAV: Array<[string, string]> = [
    ['kpi-clientes-activos', 'crm'],
    ['kpi-suspendidos', 'suspension'],
    ['kpi-mrr', 'billing'],
    ['kpi-cobranza-mes', 'payments'],
    ['kpi-tickets', 'support'],
    ['kpi-torres', 'network'],
    ['kpi-capacidad', 'inventory'],
    ['kpi-facturas-vencidas', 'billing'],
    ['kpi-provisioning-pendiente', 'provisioning'],
    ['kpi-automation-queue', 'automation'],
    ['kpi-notifications-pending', 'notifications'],
  ];

  for (const [id, tab] of NAV) {
    it(`${id} navega a "${tab}"`, () => {
      const re = new RegExp(`id: '${id}'[^\\n]*tab: '${tab}'`);
      expect(re.test(dash), `${id} debe navegar a ${tab}`).toBe(true);
    });
  }

  it('App pasa la navegación real (setActiveTab) al Dashboard', () => {
    expect(app).toContain('onNavigate={setActiveTab}');
  });
});

describe('Dashboard V3 — alertas importantes (máx. 5)', () => {
  it('renderiza la sección de alertas importantes', () => {
    expect(dash).toContain('id="dashboard-important-alerts"');
    expect(dash).toContain('Alertas Importantes');
  });

  it('limita a 5 alertas como máximo', () => {
    expect(dash).toContain('.slice(0, 5)');
  });

  it('prioriza por severidad critical > high > warning', () => {
    expect(dash).toContain('SEVERITY_WEIGHT');
    expect(dash).toContain("critical: 0");
    expect(dash).toContain("high: 1");
    expect(dash).toContain("warning: 2");
  });

  it('cada alerta es clickeable hacia su módulo', () => {
    expect(dash).toContain('onClick={go(alert.tab)}');
  });
});

describe('Dashboard V3 — acciones rápidas (5)', () => {
  it('renderiza la sección de acciones rápidas', () => {
    expect(dash).toContain('id="dashboard-quick-actions"');
    expect(dash).toContain('Acciones Rápidas');
  });

  it('define exactamente 5 acciones rápidas', () => {
    const count = (dash.match(/id: 'qa-/g) || []).length;
    expect(count).toBe(5);
  });

  it('muestra las 5 acciones solicitadas', () => {
    for (const label of ['Nuevo Cliente', 'Registrar Pago', 'Crear Ticket', 'Alta Router', 'Abrir NOC']) {
      expect(dash, `falta acción "${label}"`).toContain(label);
    }
  });
});

describe('Dashboard V3 — sin widgets duplicados (FASE A)', () => {
  it('elimina las tarjetas duplicadas del dashboard antiguo', () => {
    for (const ghost of [
      'Suscriptores Activos', // duplicado de Clientes Activos
      'hogares/suc',
      'Ingresos del mes',     // duplicado de MRR
      'SLA Tickets / Alarmas', // duplicado de Tickets Abiertos
      'Resumen operativo',
      'Operación WISP',
      'Cobranza Ejecutiva',
      'Top 10 Adeudos',
    ]) {
      expect(dash, `widget duplicado/ruidoso aún presente: "${ghost}"`).not.toContain(ghost);
    }
  });

  it('no conserva el tooling NOC en el dashboard (movido a NOC)', () => {
    for (const ghost of ['trigger-billing-bot', 'test-pings-btn', 'ack-all-alerts', 'Consola Simuladora', 'trigger-simulation']) {
      expect(dash, `tooling NOC aún en dashboard: "${ghost}"`).not.toContain(ghost);
    }
  });
});

describe('Dashboard V3 — responsive y tema', () => {
  it('KPIs en grilla responsive (2 → 4 columnas)', () => {
    expect(dash).toContain('grid-cols-2 lg:grid-cols-4');
  });

  it('acciones rápidas responsive (hasta 5 columnas)', () => {
    expect(dash).toContain('sm:grid-cols-3 lg:grid-cols-5');
  });

  it('conserva la paleta slate/indigo (sin tema nuevo)', () => {
    expect(dash).toContain('bg-slate-950');
    expect(dash).toContain('border-slate-800');
    expect(dash).toContain('bg-slate-900 min-h-screen');
  });
});

describe('Dashboard V3 — tooling NOC reubicado', () => {
  it('App monta NocOperationsPanel en el tab NOC', () => {
    expect(app).toContain('import NocOperationsPanel');
    expect(app).toContain('<NocOperationsPanel');
  });

  it('NocOperationsPanel conserva el tooling movido (no se eliminó del sistema)', () => {
    const noc = readFileSync('src/components/NocOperationsPanel.tsx', 'utf8');
    expect(noc).toContain('Alertas del NOC en Tiempo Real');
    expect(noc).toContain('id="test-pings-btn"');
    expect(noc).toContain('id="trigger-billing-bot"');
    expect(noc).toContain('Consola Simuladora de Eventos Críticos');
    expect(noc).toContain('/api/notifications/settings');
    expect(noc).toContain('/api/notifications/trigger-simulation');
  });
});
