import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/Client360Panel.tsx', 'utf8');

describe('Client 360 Automation History section (FASE K)', () => {
  it('muestra seccion Automation con eventos, decisiones y simulacion', () => {
    expect(source).toContain('aria-label="Automation"');
    expect(source).toContain('client360-automation');
    expect(source).toContain('Últimos eventos');
    expect(source).toContain('Últimas decisiones');
    expect(source).toContain('Última simulación');
  });

  it('aclara que el motor no ejecuta acciones', () => {
    expect(source).toContain('No ejecuta acciones.');
  });
});
