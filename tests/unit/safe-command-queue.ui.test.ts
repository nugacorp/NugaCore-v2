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

describe('Safe Command Queue navigation integration', () => {
  it('Sidebar incluye el item safe-command-queue', () => {
    expect(sidebarSource).toContain("id: 'safe-command-queue'");
    expect(sidebarSource).toContain('DRY RUN');
  });

  it('App importa y renderiza el módulo cuando el tab está activo', () => {
    expect(appSource).toContain(
      "import SafeCommandQueueModule from './modules/safe-command-queue/SafeCommandQueueModule'",
    );
    expect(appSource).toContain("activeTab === 'safe-command-queue'");
    expect(appSource).toContain('<SafeCommandQueueModule');
  });

  it('RBAC frontend: visible para roles permitidos, oculto para Cobranza', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbacSource, role), `${role} debería incluir safe-command-queue`).toContain(
        "'safe-command-queue'",
      );
    }
    expect(lineWith(rbacSource, "'Cobranza'")).not.toContain("'safe-command-queue'");
  });
});
