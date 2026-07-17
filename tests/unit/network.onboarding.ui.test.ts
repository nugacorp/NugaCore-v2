import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('NetworkModule onboarding UX', () => {
  const source = readFileSync('src/components/NetworkModule.tsx', 'utf8');

  it('muestra stepper de onboarding por pasos', () => {
    expect(source).toContain('tower-onboarding-stepper');
    expect(source).toContain('Zona definida');
    expect(source).toContain('Facturación (día/hora)');
  });

  it('muestra bloque de auditoría en tarjeta de torre', () => {
    expect(source).toContain('tower-onboarding-audit-');
    expect(source).toContain('Router vinculado');
    expect(source).toContain('Facturación zona');
  });
});
