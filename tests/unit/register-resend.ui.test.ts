import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RegisterWispForm — reenviar confirmación', () => {
  const source = readFileSync('src/components/RegisterWispForm.tsx', 'utf8');

  it('muestra botón de reenviar en la pantalla de espera de correo', () => {
    expect(source).toContain('register-resend-confirmation');
    expect(source).toContain('Reenviar confirmación');
    expect(source).toContain("type: 'signup'");
    expect(source).toContain('auth.resend');
  });
});
