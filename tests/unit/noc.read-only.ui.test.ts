import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync('src/components/NocReadOnlyModule.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((line) => line.includes(needle)) ?? '';

describe('NOC Read-Only module UI contract', () => {
  it('marca la vista como READ-ONLY', () => {
    expect(moduleSource).toContain('READ-ONLY');
  });

  it('usa solo endpoints GET de NOC', () => {
    expect(moduleSource).toContain('/api/noc/summary');
    expect(moduleSource).toContain('/api/noc/routers');
    expect(moduleSource).toContain('/api/noc/alerts');
  });

  it('no declara operaciones write en fetch', () => {
    expect(moduleSource).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
  });

  it('incluye empty state y mensaje de no acción', () => {
    expect(moduleSource).toContain('No hay routers disponibles para monitoreo NOC.');
    expect(moduleSource).toContain('Esta vista no ejecuta comandos ni modifica routers.');
  });
});

describe('NOC Read-Only RBAC visibility', () => {
  it('es visible para roles permitidos', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbacSource, role), `${role} debería incluir noc`).toContain("'noc'");
    }
  });

  it('no es visible para Cobranza', () => {
    expect(lineWith(rbacSource, "'Cobranza'")).not.toContain("'noc'");
  });

  it('está en sidebar y App dispatcher', () => {
    expect(sidebarSource).toContain("id: 'noc'");
    expect(appSource).toContain("activeTab === 'noc'");
    expect(appSource).toContain('<NocReadOnlyModule');
  });
});
