import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// FAST-1 Safe Command Queue — contrato de UI (DRY RUN, sin ejecución real).
// ====================================================================

const moduleSource = readFileSync('src/modules/safe-command-queue/SafeCommandQueueModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((line) => line.includes(needle)) ?? '';

describe('Safe Command Queue module UI contract', () => {
  it('marca la vista como DRY RUN', () => {
    expect(moduleSource).toContain('DRY RUN');
  });

  it('muestra el mensaje de no-ejecución requerido', () => {
    expect(moduleSource).toContain('Esta cola NO ejecuta comandos reales.');
  });

  it('usa los endpoints de safe-command-queue y las transiciones', () => {
    expect(moduleSource).toContain('/api/safe-command-queue');
    for (const op of ['validate', 'simulate', 'approve', 'reject', 'cancel']) {
      expect(moduleSource, `falta la transición ${op}`).toContain(`'${op}'`);
    }
  });

  it('incluye lista, detalle, comandos simulados y auditoría', () => {
    expect(moduleSource).toContain('Comandos en cola');
    expect(moduleSource).toContain('Comandos simulados (no ejecutados)');
    expect(moduleSource).toContain('Detalle, dry-run y auditoría');
    expect(moduleSource).toContain('No hay comandos en la cola.');
  });

  it('no tiene botón ni endpoint de ejecución real', () => {
    expect(moduleSource).not.toContain('/execute');
    expect(moduleSource).not.toContain('Ejecutar');
    expect(moduleSource).not.toContain("'EXECUTED'");
  });
});

describe('Safe Command Queue — herramienta interna (no es módulo de sidebar)', () => {
  it('NO se renderiza como item operativo en el sidebar', () => {
    // Decisión de producto: herramienta interna de seguridad, no módulo de
    // operación normal. Sigue accesible por tab/URL directo.
    expect(sidebarSource).not.toContain("id: 'safe-command-queue'");
  });

  it('rbac.ts lo marca oculto del sidebar pero conserva el acceso', () => {
    expect(rbacSource).toContain("'safe-command-queue'");
    expect(rbacSource).toContain('SIDEBAR_HIDDEN_TABS');
    expect(rbacSource).toContain('isVisibleInSidebar');
  });

  it('App importa y renderiza el módulo cuando el tab está activo (acceso directo)', () => {
    expect(appSource).toContain(
      "const SafeCommandQueueModule = lazyWithRetry(() => import('./modules/safe-command-queue/SafeCommandQueueModule'))",
    );
    expect(appSource).toContain("activeTab === 'safe-command-queue'");
    expect(appSource).toContain('<SafeCommandQueueModule');
  });

  it('RBAC interno: accesible para roles permitidos, no para Cobranza', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbacSource, role), `${role} debería incluir safe-command-queue`).toContain(
        "'safe-command-queue'",
      );
    }
    expect(lineWith(rbacSource, "'Cobranza'")).not.toContain("'safe-command-queue'");
  });
});
