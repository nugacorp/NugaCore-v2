import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FILES = [
  'backend/domains/provisioning/types.ts',
  'backend/domains/provisioning/store.ts',
  'backend/domains/provisioning/service.ts',
  'backend/domains/provisioning/routes.ts',
  'src/modules/provisioning/ProvisioningCenterModule.tsx',
  'src/lib/provisioningRbac.ts',
];

const FORBIDDEN = [
  'execute',
  'routeros write',
  'mikrotik api write',
  'worker live',
  'shell',
  'ssh',
  'add(',
  'set(',
  'remove(',
];

describe('provisioning static safety', () => {
  it('no contiene primitivas de escritura ni operacion live', () => {
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8').toLowerCase();
      for (const token of FORBIDDEN) {
        expect(source, `${file} contiene ${token}`).not.toContain(token);
      }
    }
  });
});
