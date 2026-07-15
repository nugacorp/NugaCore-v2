import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Fase 4.3.1 — Hardening de login.
//
// Evidencia automatizada de que NO hay credenciales embebidas, NI usuarios
// demo inseguros, NI bypass de autenticación en el frontend, y que el quick
// login de staging solo prerellena emails (sin passwords). Escaneo de fuente
// (mismo patrón que rbac.frontend.test.ts) → robusto y sin dependencias DOM.
// ====================================================================

const read = (p: string) => readFileSync(p, 'utf8');

const loginForm = read('src/components/LoginForm.tsx');
const landing = read('src/components/LandingPage.tsx');
const supabaseLib = read('src/lib/supabase.ts');
const appTsx = read('src/App.tsx');
const serverTs = read('server.ts');

describe('Hardening — sin secretos hardcodeados', () => {
  it('no existe el password demo hardcodeado en ningún archivo de login', () => {
    for (const src of [loginForm, landing, supabaseLib, appTsx]) {
      expect(src).not.toContain('nugacorp_secure_pwd2026');
    }
  });

  it('el autofill nunca setea un password literal (solo lo limpia)', () => {
    // Permitido: setPassword('') o setPassword(<state>). Prohibido: setPassword('algo').
    const setPwLiterals = loginForm.match(/setPassword\(\s*'([^']+)'\s*\)/g) || [];
    expect(setPwLiterals, `setPassword con literal: ${setPwLiterals.join(', ')}`).toHaveLength(0);
  });

  it('no hay tokens/JWT embebidos en el cliente de login', () => {
    for (const src of [loginForm, landing, supabaseLib]) {
      expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./); // forma típica de un JWT
    }
  });
});

describe('Hardening — sin usuarios demo inseguros', () => {
  it('MOCK_USER_PROFILES fue eliminado de supabase.ts', () => {
    expect(supabaseLib).not.toContain('MOCK_USER_PROFILES');
  });

  it('LoginForm y LandingPage ya no importan perfiles demo', () => {
    expect(loginForm).not.toContain('MOCK_USER_PROFILES');
    expect(landing).not.toContain('MOCK_USER_PROFILES');
  });

  it('no quedan correos demo @nugacorp.com en los accesos rápidos', () => {
    // El quick login debe usar dominio de staging, no el demo público.
    expect(loginForm).not.toContain('@nugacorp.com');
    expect(landing).not.toContain('handleQuickDemoClick(\'');
  });
});

describe('Hardening — sin bypass de autenticación', () => {
  it('LandingPage ya no expone onInstantDemo (login sin auth)', () => {
    expect(landing).not.toContain('onInstantDemo');
  });

  it('App.tsx ya no cablea un instant-demo a handleLoginSuccess', () => {
    expect(appTsx).not.toContain('onInstantDemo');
  });

  it('el modo sin Supabase NO inicia sesión: muestra error', () => {
    // Se eliminó el login-sin-password de preview.
    expect(loginForm).not.toContain('Simulando acceso exitoso');
    expect(loginForm).toContain('backend de autenticación no está configurado');
  });
});

describe('Hardening — quick login de staging seguro', () => {
  it('STAGING_QUICK_LOGINS existe y está gateado por VITE_ENABLE_QUICK_LOGIN', () => {
    expect(supabaseLib).toContain('STAGING_QUICK_LOGINS');
    expect(supabaseLib).toContain('isQuickLoginEnabled');
    expect(supabaseLib).toContain('VITE_ENABLE_QUICK_LOGIN');
  });

  it('todos los emails de quick login usan el dominio de staging', () => {
    const emails = (supabaseLib.match(/[\w.+-]+@[\w.-]+/g) || []).filter((e) =>
      e.includes('staging.nugacore.local'),
    );
    expect(emails.length).toBe(6);
    // y no hay emails @nugacorp.com en la lista de staging
    expect(supabaseLib).not.toContain('@nugacorp.com');
  });

  it('el panel de quick login en LoginForm está condicionado al flag', () => {
    expect(loginForm).toContain('isQuickLoginEnabled');
    expect(loginForm).toContain('STAGING_QUICK_LOGINS');
  });
});

describe('Hardening — cache busting', () => {
  it('index.html se sirve sin cache (no-cache) en server.ts', () => {
    expect(serverTs).toMatch(/index\.html[\s\S]{0,400}no-cache/);
  });

  it('los assets hasheados se sirven inmutables (1 año)', () => {
    expect(serverTs).toContain('immutable');
    expect(serverTs).toContain('31536000');
  });

  it('chunks faltantes responden 404 y no HTML (evita MIME module error)', () => {
    expect(serverTs).toContain('looksLikeStaticFile');
    expect(serverTs).toMatch(/status\(404\)/);
  });
});
