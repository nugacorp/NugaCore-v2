import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// FASE O — Static Safety. El Automation Engine SOLO decide; nunca ejecuta.
// Estos archivos no deben contener primitivas de ejecucion ni operacion live.
const FILES = [
  'backend/domains/automation/types.ts',
  'backend/domains/automation/store.ts',
  'backend/domains/automation/rules.ts',
  'backend/domains/automation/service.ts',
  'backend/domains/automation/audit.ts',
  'backend/domains/automation/routes.ts',
  'src/modules/automation/AutomationCenterModule.tsx',
  'src/lib/automationRbac.ts',
];

// Nota: usamos 'exec(' (llamada) en vez del literal 'exec' para no chocar con
// el termino legitimo 'executionPreview' (FASE H). El resto son tokens exactos.
const FORBIDDEN = [
  'exec(',
  'execsync',
  'execute',
  'spawn',
  'shell',
  'ssh',
  'routeros',
  'worker live',
  'child_process',
  'add(',
  'set(',
  'remove(',
];

describe('automation static safety (FASE O)', () => {
  it('no contiene primitivas de escritura ni operacion live', () => {
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8').toLowerCase();
      for (const token of FORBIDDEN) {
        expect(source, `${file} contiene ${token}`).not.toContain(token);
      }
    }
  });
});
