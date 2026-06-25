import { describe, expect, it } from 'vitest';
import { buildExecutionPreview } from '../../backend/domains/automation/rules';
import { AUTOMATION_DECISIONS } from '../../backend/domains/automation/types';

describe('automation execution preview (FASE H)', () => {
  it('cada decision produce un executionPreview descriptivo', () => {
    for (const decision of AUTOMATION_DECISIONS) {
      const preview = buildExecutionPreview(decision, 'cust-1');
      expect(preview.length, `sin preview para ${decision}`).toBeGreaterThan(0);
      expect(preview.every((step) => typeof step.description === 'string' && step.description.length > 0)).toBe(true);
      expect(preview.every((step) => typeof step.id === 'string')).toBe(true);
    }
  });

  it('REQUEST_SUSPENSION describe los pasos esperados y espera aprobacion', () => {
    const preview = buildExecutionPreview('REQUEST_SUSPENSION', 'cust-9');
    const joined = preview.map((step) => step.description).join(' | ');
    expect(joined).toContain('Service Status');
    expect(joined).toContain('Provisioning');
    expect(joined.toLowerCase()).toContain('aprobacion');
    expect(joined).toContain('cust-9');
  });

  it('el preview es puramente descriptivo (sin primitivas de ejecucion)', () => {
    for (const decision of AUTOMATION_DECISIONS) {
      const joined = buildExecutionPreview(decision).map((step) => step.description).join(' ').toLowerCase();
      for (const forbidden of ['exec(', 'ssh', 'shell', 'spawn', 'routeros', 'worker live']) {
        expect(joined, `${decision} preview contiene ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('NOTHING devuelve un paso de "sin accion"', () => {
    const preview = buildExecutionPreview('NOTHING');
    expect(preview).toHaveLength(1);
    expect(preview[0].description.toLowerCase()).toContain('sin accion');
  });
});
