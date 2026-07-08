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

describe('Manual Safe Mode — herramienta interna (no es módulo de sidebar)', () => {
  it('NO se renderiza como item operativo en el sidebar', () => {
    // Decisión de producto: es una herramienta interna de seguridad, no un
    // módulo de operación normal. Sigue accesible por tab/URL directo.
    expect(sidebarSource).not.toContain("id: 'manual-safe-mode'");
  });

  it('rbac.ts lo marca oculto del sidebar pero conserva el acceso', () => {
    expect(rbacSource).toContain("'manual-safe-mode'");
    expect(rbacSource).toContain('SIDEBAR_HIDDEN_TABS');
    expect(rbacSource).toContain('isVisibleInSidebar');
  });

  it('App importa y renderiza el módulo cuando el tab está activo (acceso directo)', () => {
    expect(appSource).toContain("const ManualSafeModeModule = lazyWithRetry(() => import('./modules/manual-safe-mode/ManualSafeModeModule'))");
    expect(appSource).toContain("activeTab === 'manual-safe-mode'");
    expect(appSource).toContain('<ManualSafeModeModule');
  });

  it('RBAC interno: accesible para roles permitidos, no para Cobranza', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbacSource, role), `${role} debería incluir manual-safe-mode`).toContain("'manual-safe-mode'");
    }
    expect(lineWith(rbacSource, "'Cobranza'")).not.toContain("'manual-safe-mode'");
  });
});
