import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Consola del propietario — sin simulador ni workflows IA', () => {
  const source = readFileSync('src/components/FinanceOwnerModule.tsx', 'utf8');

  it('elimina simulador app cliente y workflows', () => {
    expect(source).not.toContain('Simulador App Cliente');
    expect(source).not.toContain('btn-owner-portal');
    expect(source).not.toContain('Previsualizador de Portal');
    expect(source).not.toContain('Workflows de IA');
    expect(source).not.toContain('btn-owner-automations');
    expect(source).not.toContain('activeSubTab === \'portal\'');
    expect(source).not.toContain('activeSubTab === \'automations\'');
  });

  it('conserva seguridad para el operador WISP', () => {
    expect(source).toContain('btn-owner-security');
    expect(source).toContain('Consola del Propietario');
    expect(source).toContain('Seguridad (MFA & API Logs)');
  });
});
