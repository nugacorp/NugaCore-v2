import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');
const manualSource = readFileSync('src/modules/user-manual/UserManualModule.tsx', 'utf8');

describe('Automation Center — retirado de la UI WISP', () => {
  it('no aparece en el sidebar operativo', () => {
    expect(sidebarSource).not.toContain("id: 'automation'");
    expect(sidebarSource).not.toContain('Automatización');
    expect(sidebarSource).not.toContain('Automation Center');
  });

  it('App no monta el módulo', () => {
    expect(appSource).not.toContain('AutomationCenterModule');
    expect(appSource).not.toContain("activeTab === 'automation'");
    expect(appSource).not.toContain("modules/automation/AutomationCenterModule");
  });

  it('ningún rol tiene acceso al tab automation', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Cobranza'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      const line = rbacSource.split('\n').find((item) => item.includes(role)) ?? '';
      expect(line, `${role} no debería incluir automation`).not.toContain("'automation'");
    }
    expect(rbacSource).toContain("'automation'");
  });

  it('el Manual de Usuario no documenta Automation Center', () => {
    expect(manualSource).not.toContain("id: 'automation'");
    expect(manualSource).not.toContain('Automation Center');
  });
});
