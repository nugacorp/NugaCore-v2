import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');
const manualSource = readFileSync('src/modules/user-manual/UserManualModule.tsx', 'utf8');
const bellSource = readFileSync('src/components/TopAlertsBell.tsx', 'utf8');

describe('Notification Center — retirado; campana operativa en top bar', () => {
  it('no aparece el módulo Notification Center en sidebar/App/manual', () => {
    expect(sidebarSource).not.toContain("id: 'notifications'");
    expect(sidebarSource).not.toContain('Notificaciones');
    expect(appSource).not.toContain('NotificationCenterModule');
    expect(appSource).not.toContain("activeTab === 'notifications'");
    expect(manualSource).not.toContain("id: 'notifications'");
    expect(manualSource).not.toContain('Notification Center');
  });

  it('ningún rol tiene acceso al tab notifications', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Cobranza'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      const line = rbacSource.split('\n').find((item) => item.includes(role)) ?? '';
      expect(line, `${role} no debería incluir notifications`).not.toContain("'notifications'");
    }
  });

  it('App monta la campana de alertas operativas (NOC)', () => {
    expect(appSource).toContain('TopAlertsBell');
    expect(appSource).toContain('id="desktop-top-bar"');
    expect(bellSource).toContain('id="top-alerts-bell"');
    expect(bellSource).toContain('Alertas operativas');
    expect(bellSource).toContain('btn-top-alerts-ack-all');
  });
});
