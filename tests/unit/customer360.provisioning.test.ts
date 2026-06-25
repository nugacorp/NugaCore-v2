import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/Client360Panel.tsx', 'utf8');

describe('Client 360 provisioning section', () => {
  it('muestra seccion Provisioning con datos requeridos', () => {
    expect(source).toContain('aria-label="Provisioning"');
    expect(source).toContain('Última acción');
    expect(source).toContain('Estado');
    expect(source).toContain('Fecha');
    expect(source).toContain('Resultado simulación');
    expect(source).toContain('Ver historial');
    expect(source).toContain('client360-provisioning');
  });
});
