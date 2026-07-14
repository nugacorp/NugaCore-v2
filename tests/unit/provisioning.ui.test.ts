import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const moduleSource = readFileSync('src/modules/provisioning/ProvisioningCenterModule.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

describe('Provisioning Center UI', () => {
  it('está oculto del sidebar (dry-run avanzado) pero declarado en RBAC', () => {
    expect(sidebarSource).not.toContain("id: 'provisioning'");
    expect(rbacSource).toContain("'provisioning'");
  });

  it('muestra badge gated y banner dry-run', () => {
    expect(moduleSource).toContain('ProductionGateBadge');
    expect(moduleSource).toContain('provisioningExecute');
    expect(moduleSource).toContain('Las acciones mostradas aquí NO ejecutan cambios reales.');
  });

  it('muestra columnas, plan y botones permitidos', () => {
    for (const text of ['Acción', 'Cliente', 'Estado', 'Fecha', 'Plan de ejecución']) {
      expect(moduleSource).toContain(text);
    }
    for (const text of ['Validar', 'Simular', 'Aprobar', 'Rechazar', 'Cancelar']) {
      expect(moduleSource).toContain(text);
    }
    expect(moduleSource).not.toContain('Ejecutar');
  });

  it('App renderiza el modulo y RBAC lo expone a roles de lectura', () => {
    expect(appSource).toContain("const ProvisioningCenterModule = lazyWithRetry(() => import('./modules/provisioning/ProvisioningCenterModule'))");
    expect(appSource).toContain("activeTab === 'provisioning'");
    for (const role of ["'Super Admin'", "'Administrador'", "'Cobranza'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      const line = rbacSource.split('\n').find((item) => item.includes(role)) ?? '';
      expect(line).toContain("'provisioning'");
    }
  });
});
