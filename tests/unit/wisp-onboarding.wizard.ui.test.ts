import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WispOnboardingWizard — sin duplicar datos del registro', () => {
  const source = readFileSync('src/components/WispOnboardingWizard.tsx', 'utf8');

  it('omite el paso company cuando el registro ya guardó la empresa', () => {
    expect(source).toContain('companyAlreadySet');
    expect(source).toContain("ALL_STEPS.filter((s) => s.id !== 'company')");
    expect(source).toContain('Empresa guardada:');
  });
});
