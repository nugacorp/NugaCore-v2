import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync('src/modules/automation/AutomationCenterModule.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');
const manualSource = readFileSync('src/modules/user-manual/UserManualModule.tsx', 'utf8');

describe('Automation Center UI', () => {
  it('esta en Sistema, debajo de Configuracion y encima del Manual', () => {
    expect(sidebarSource).toContain("id: 'automation'");
    expect(sidebarSource.indexOf("name: 'Configuración'")).toBeLessThan(sidebarSource.indexOf("name: 'Automation Center'"));
    expect(sidebarSource.indexOf("name: 'Automation Center'")).toBeLessThan(sidebarSource.indexOf("name: 'Manual de Usuario'"));
  });

  it('muestra badge DRY RUN y el banner obligatorio', () => {
    expect(moduleSource).toContain('DRY RUN');
    expect(moduleSource).toContain('El motor de automatización únicamente toma decisiones. No ejecuta acciones reales.');
  });

  it('incluye las 5 pantallas requeridas', () => {
    for (const text of ['Resumen', 'Eventos', 'Reglas', 'Decisiones simuladas', 'Execution Preview']) {
      expect(moduleSource).toContain(text);
    }
  });

  it('no expone un boton de ejecucion real', () => {
    expect(moduleSource).not.toContain('Ejecutar');
  });

  it('App renderiza el modulo y RBAC lo expone a todos los roles', () => {
    expect(appSource).toContain("import AutomationCenterModule from './modules/automation/AutomationCenterModule'");
    expect(appSource).toContain("activeTab === 'automation'");
    for (const role of ["'Super Admin'", "'Administrador'", "'Cobranza'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      const line = rbacSource.split('\n').find((item) => item.includes(role)) ?? '';
      expect(line).toContain("'automation'");
    }
  });

  it('el Manual de Usuario documenta Automation Center', () => {
    expect(manualSource).toContain("id: 'automation'");
    expect(manualSource).toContain('Automation Center');
  });
});
