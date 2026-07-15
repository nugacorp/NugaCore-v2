import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Fase 4.5.2 — La app de staging debe servir el build estático, no el
// Vite dev server, y nunca con allowedHosts wildcard.
// (Scan de fuente, mismo patrón que login.hardening / rbac.frontend.)
// ====================================================================

const serverTs = readFileSync('server.ts', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');

describe('serve mode (staging UI host block)', () => {
  it('server.ts decide el modo con resolveServeMode (no solo NODE_ENV)', () => {
    expect(serverTs).toContain('resolveServeMode');
  });

  it('producción y builds existentes → servido estático', () => {
    expect(serverTs).toMatch(/if\s*\(isProduction\)\s*return\s*'static'/);
    expect(serverTs).toContain("dist', 'index.html'"); // detecta build presente
    expect(serverTs).toContain('hasBuild');
  });

  it('soporta SERVE_MODE explícito para forzar estático en staging', () => {
    expect(serverTs).toContain('SERVE_MODE');
  });

  it('NO usa allowedHosts wildcard (true) en server.ts ni vite.config', () => {
    expect(serverTs).not.toMatch(/allowedHosts\s*:\s*true/);
    expect(viteConfig).not.toMatch(/allowedHosts\s*:\s*true/);
    // allowedHosts solo desde env explícito.
    expect(serverTs).toContain('VITE_ALLOWED_HOSTS');
    expect(viteConfig).toContain('VITE_ALLOWED_HOSTS');
  });

  it('el Vite dev server solo se usa en modo dev', () => {
    expect(serverTs).toMatch(/serveMode === 'dev'/);
    // El import de vite es perezoso (no eager en el bundle de producción).
    expect(serverTs).toContain("await import('vite')");
  });

  it('SPA fallback NO sirve index.html para assets .js/.css faltantes (MIME fix)', () => {
    expect(serverTs).toContain('looksLikeStaticFile');
    expect(serverTs).toContain("status(404)");
    expect(serverTs).toMatch(/Not found/);
  });
});
