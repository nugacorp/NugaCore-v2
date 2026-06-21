import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-1 Manual Safe Mode — contrato de UI (SAFE MODE, sin ejecución real).
// ====================================================================

const moduleSource = readFileSync('src/modules/manual-safe-mode/ManualSafeModeModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((line) => line.includes(needle)) ?? '';

describe('Manual Safe Mode module UI contract', () => {
  it('marca la vista como SAFE MODE', () => {
    expect(moduleSource).toContain('SAFE MODE');
  });

  it('muestra el texto de no-ejecución requerido', () => {
    expect(moduleSource).toContain(
      'Esta funcionalidad NO ejecuta cambios reales. Todas las acciones son simuladas.',
    );
  });

  it('usa los endpoints de manual-actions (base + transiciones)', () => {
    expect(moduleSource).toContain('/api/manual-actions');
    // Las transiciones se construyen con template dinámico /${op}.
    for (const op of ['approve', 'reject', 'simulate', 'cancel']) {
      expect(moduleSource, `falta la transición ${op}`).toContain(`'${op}'`);
    }
  });

  it('incluye tabla de acciones, detalle e historial de auditoría', () => {
    expect(moduleSource).toContain('Acciones manuales');
    expect(moduleSource).toContain('Detalle e historial de auditoría');
    expect(moduleSource).toContain('No hay acciones manuales registradas.');
  });

  it('no invoca ejecución real (sin endpoint /execute, sin botón "Ejecutar")', () => {
    expect(moduleSource).not.toContain('/execute');
    // No declara EXECUTED como estado real (solo se menciona en comentario para negarlo).
    expect(moduleSource).not.toContain("'EXECUTED'");
    // No hay acción real "Ejecutar" en la UI.
    expect(moduleSource).not.toContain('Ejecutar');
  });
});

describe('Manual Safe Mode navigation integration', () => {
  it('Sidebar incluye el item manual-safe-mode', () => {
    expect(sidebarSource).toContain("id: 'manual-safe-mode'");
    expect(sidebarSource).toContain('SAFE MODE');
  });

  it('App importa y renderiza el módulo cuando el tab está activo', () => {
    expect(appSource).toContain("import ManualSafeModeModule from './modules/manual-safe-mode/ManualSafeModeModule'");
    expect(appSource).toContain("activeTab === 'manual-safe-mode'");
    expect(appSource).toContain('<ManualSafeModeModule');
  });

  it('RBAC frontend: visible para roles permitidos, oculto para Cobranza', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbacSource, role), `${role} debería incluir manual-safe-mode`).toContain("'manual-safe-mode'");
    }
    expect(lineWith(rbacSource, "'Cobranza'")).not.toContain("'manual-safe-mode'");
  });
});
