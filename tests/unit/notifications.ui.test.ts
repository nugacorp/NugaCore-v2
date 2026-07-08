import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync('src/modules/notifications/NotificationCenterModule.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');
const manualSource = readFileSync('src/modules/user-manual/UserManualModule.tsx', 'utf8');

describe('Notification Center UI', () => {
  it('está en Sistema, debajo de Automation Center', () => {
    expect(sidebarSource).toContain("id: 'notifications'");
    expect(sidebarSource.indexOf("name: 'Automation Center'")).toBeLessThan(sidebarSource.indexOf("name: 'Notification Center'"));
  });

  it('muestra badge DRY RUN y el banner obligatorio', () => {
    expect(moduleSource).toContain('DRY RUN');
    expect(moduleSource).toContain('Las notificaciones están en modo simulación. No se envían mensajes reales.');
  });

  it('incluye las 5 pantallas requeridas', () => {
    for (const text of ['Resumen', 'Templates', 'Mensajes', 'Simulaciones', 'Canales']) {
      expect(moduleSource).toContain(text);
    }
  });

  it('tiene botones Vista previa / Simular / Cancelar y NO Enviar/Dispatch', () => {
    expect(moduleSource).toContain('Vista previa');
    expect(moduleSource).toContain('Simular');
    expect(moduleSource).toContain('Cancelar');
    expect(moduleSource).not.toContain('Enviar');
    expect(moduleSource).not.toContain('Dispatch');
  });

  it('App renderiza el módulo y RBAC lo expone a todos los roles', () => {
    expect(appSource).toContain("const NotificationCenterModule = lazyWithRetry(() => import('./modules/notifications/NotificationCenterModule'))");
    expect(appSource).toContain("activeTab === 'notifications'");
    for (const role of ["'Super Admin'", "'Administrador'", "'Cobranza'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      const line = rbacSource.split('\n').find((item) => item.includes(role)) ?? '';
      expect(line).toContain("'notifications'");
    }
  });

  it('el Manual de Usuario documenta Notification Center', () => {
    expect(manualSource).toContain("id: 'notifications'");
    expect(manualSource).toContain('Notification Center');
  });
});
