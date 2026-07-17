import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('authSession — sesión zombie', () => {
  const source = readFileSync('src/lib/authSession.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  it('valida con getUser antes de llamar /api/auth/me', () => {
    expect(source).toContain('auth.getUser()');
    expect(source).toContain('clearLocalAndRemoteSession');
    expect(source).toMatch(/getUser[\s\S]*fetchProfileFromBackend/);
  });

  it('App no hidrata perfil cacheado con Supabase hasta bootstrap', () => {
    expect(app).toContain('isSupabaseConfigured ? null : authSession.readProfile()');
  });
});
