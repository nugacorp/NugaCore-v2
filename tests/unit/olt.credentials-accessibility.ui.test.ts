import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Accesibilidad del formulario de credenciales OLT', () => {
  const source = readFileSync('src/components/OltModule.tsx', 'utf8');

  it('da nombres accesibles estables y metadatos de autocompletado a las credenciales', () => {
    const usernameInput = source.match(/<input placeholder="Usuario SSH"[\s\S]*?\/>/)?.[0] ?? '';
    const passwordInput = source.match(/<input type="password" placeholder="Password \(mínimo 8\)"[\s\S]*?\/>/)?.[0] ?? '';

    expect(usernameInput).toContain('aria-label="Usuario SSH"');
    expect(usernameInput).toContain('name="username"');
    expect(usernameInput).toContain('autoComplete="username"');

    expect(passwordInput).toContain('aria-label="Password SSH"');
    expect(passwordInput).toContain('name="password"');
    expect(passwordInput).toContain('autoComplete="current-password"');
  });
});
