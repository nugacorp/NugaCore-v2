import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// FASE O — Static Safety. El Automation Engine SOLO decide por defecto.
// La ejecución gated vive en production-gates.ts (referencias permitidas).
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

const stripGatedLines = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !line.toLowerCase().includes('productiongates'))
    .join('\n');

const FORBIDDEN = [
  'exec(',
  'execsync',
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
  it('no contiene primitivas de escritura ni operacion live (sin gates)', () => {
    for (const file of FILES) {
      const source = stripGatedLines(readFileSync(file, 'utf8')).toLowerCase();
      for (const token of FORBIDDEN) {
        expect(source, `${file} contiene ${token}`).not.toContain(token);
      }
    }
  });
});
