import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-3 RouterOS Read-Only Lab — contrato UI.
// ====================================================================

const moduleSource = readFileSync('src/modules/routeros-readonly/RouterOSReadOnlyModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((line) => line.includes(needle)) ?? '';

describe('RouterOS Read-Only Lab UI contract', () => {
  it('marca la vista como read-only lab y advierte no ejecución', () => {
    expect(moduleSource).toContain('READ ONLY LAB');
    expect(moduleSource).toContain('Esta vista no ejecuta cambios ni comandos RouterOS.');
  });

  it('muestra identidad, sistema, interfaces, WireGuard y rutas', () => {
    for (const label of ['Identidad', 'RouterOS', 'CPU', 'RAM', 'Interfaces', 'WireGuard', 'Rutas']) {
      expect(moduleSource).toContain(label);
    }
  });

  it('usa solo endpoints GET read-only y no contiene rutas write', () => {
    expect(moduleSource).toContain("const paths = ['identity', 'system', 'interfaces', 'routes', 'wireguard']");
    expect(moduleSource).toContain('fetch(`/api/routeros/${path}`, { headers })');
    expect(moduleSource).not.toContain('/execute');
    expect(moduleSource).not.toContain("method: 'POST'");
    expect(moduleSource).not.toContain("method: 'PUT'");
    expect(moduleSource).not.toContain("method: 'PATCH'");
    expect(moduleSource).not.toContain("method: 'DELETE'");
  });
});

describe('RouterOS Read-Only Lab navigation integration', () => {
  it('Sidebar incluye el item routeros-readonly (badge READ ONLY LAB vive en el módulo, no en el sidebar)', () => {
    expect(sidebarSource).toContain("id: 'routeros-readonly'");
    expect(sidebarSource).toContain('RouterOS Lab');
    // Reorganización UX: el badge de estado se muestra dentro del módulo.
    expect(sidebarSource).not.toContain('READ ONLY LAB');
  });

  it('App importa y renderiza el módulo cuando el tab está activo', () => {
    expect(appSource).toContain("import RouterOSReadOnlyModule from './modules/routeros-readonly/RouterOSReadOnlyModule'");
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
