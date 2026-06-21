import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-3 RouterOS Read-Only Lab — contrato de UI (READ ONLY LAB, sin
// ejecución, sin botones de escritura).
// ====================================================================

const moduleSource = readFileSync('src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((line) => line.includes(needle)) ?? '';

describe('RouterOS Read-Only module UI contract', () => {
  it('marca la vista como READ ONLY LAB', () => {
    expect(moduleSource).toContain('READ ONLY LAB');
  });

  it('muestra el banner obligatorio de no-ejecución', () => {
    expect(moduleSource).toContain('Esta vista no ejecuta cambios ni comandos RouterOS.');
  });

  it('muestra el título RouterOS Read-Only Lab', () => {
    expect(moduleSource).toContain('RouterOS Read-Only Lab');
  });

  it('usa los endpoints read-only de RouterOS', () => {
    expect(moduleSource).toContain('/api/routeros/');
  });

  it('incluye identidad, sistema, CPU/RAM, interfaces, rutas y WireGuard summary', () => {
    expect(moduleSource).toContain('Identidad');
    expect(moduleSource).toContain('Sistema');
    expect(moduleSource).toContain('CPU & RAM');
    expect(moduleSource).toContain('Interfaces');
    expect(moduleSource).toContain('Rutas');
    expect(moduleSource).toContain('WireGuard summary');
  });

  it('tiene estados seguros de vacío y error', () => {
    expect(moduleSource).toContain('No hay datos RouterOS disponibles.');
    expect(moduleSource).toContain('setError');
  });

  it('no tiene botón ni endpoint de ejecución/escritura', () => {
    expect(moduleSource).not.toContain('/execute');
    expect(moduleSource).not.toContain('Ejecutar');
    expect(moduleSource).not.toContain('method: \'POST\'');
    expect(moduleSource).not.toContain('method: \'PUT\'');
    expect(moduleSource).not.toContain('method: \'DELETE\'');
  });
});

describe('RouterOS Read-Only navigation integration', () => {
  it('Sidebar incluye el item routeros-readonly con badge READ ONLY LAB', () => {
    expect(sidebarSource).toContain("id: 'routeros-readonly'");
    expect(sidebarSource).toContain('READ ONLY LAB');
  });

  it('App importa y renderiza el módulo cuando el tab está activo', () => {
    expect(appSource).toContain(
      "import RouterOSReadOnlyModule from './modules/routeros-readonly/RouterOSReadOnlyModule'",
    );
    expect(appSource).toContain("activeTab === 'routeros-readonly'");
    expect(appSource).toContain('<RouterOSReadOnlyModule');
  });

  it('RBAC frontend: visible para roles permitidos, oculto para Cobranza', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbacSource, role), `${role} debería incluir routeros-readonly`).toContain(
        "'routeros-readonly'",
      );
    }
    expect(lineWith(rbacSource, "'Cobranza'")).not.toContain("'routeros-readonly'");
  });
});
