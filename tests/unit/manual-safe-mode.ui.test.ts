import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-1 Manual Safe Mode — contrato de UI (SAFE MODE, sin ejecución real).
// ====================================================================

const moduleSource = readFileSync('src/modules/manual-safe-mode/ManualSafeModeModule.tsx', 'utf8');

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

  it('no invoca ejecución real (sin endpoint /execute)', () => {
    expect(moduleSource).not.toContain('/execute');
    // No declara EXECUTED como estado real (solo se menciona en comentario para negarlo).
    expect(moduleSource).not.toContain("'EXECUTED'");
  });
});
