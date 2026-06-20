import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// NOC Real Telemetry (Fase 4.11.3) — contrato de UI READ-ONLY.
// ====================================================================

const moduleSource = readFileSync('src/components/NocTelemetryModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

describe('NOC Real Telemetry module UI contract', () => {
  it('marca la vista como READ-ONLY', () => {
    expect(moduleSource).toContain('READ-ONLY');
  });

  it('usa solo endpoints GET de telemetría NOC', () => {
    expect(moduleSource).toContain('/api/noc/health');
    expect(moduleSource).toContain('/api/noc/towers');
    expect(moduleSource).toContain('/api/noc/alerts');
  });

  it('no declara operaciones write en fetch', () => {
    expect(moduleSource).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });

  it('incluye los widgets requeridos', () => {
    for (const label of ['Routers Online', 'Routers Offline', 'Warnings', 'Critical', 'Torres monitoreadas']) {
      expect(moduleSource, `falta widget ${label}`).toContain(label);
    }
  });

  it('incluye las columnas de la tabla por router', () => {
    for (const column of ['Router', 'Torre', 'Estado', 'CPU', 'RAM', 'Último check']) {
      expect(moduleSource, `falta columna ${column}`).toContain(column);
    }
  });

  it('incluye panel de alertas, empty state y mensaje de no acción', () => {
    expect(moduleSource).toContain('Panel de alertas derivadas');
    expect(moduleSource).toContain('No hay routers disponibles para telemetría NOC.');
    expect(moduleSource).toContain('Esta vista no ejecuta acciones ni modifica routers.');
  });
});

describe('NOC Real Telemetry App integration', () => {
  it('App renderiza NocTelemetryModule dentro del tab noc', () => {
    expect(appSource).toContain("activeTab === 'noc'");
    expect(appSource).toContain('<NocTelemetryModule');
    expect(appSource).toContain("import NocTelemetryModule from './components/NocTelemetryModule'");
  });
});
