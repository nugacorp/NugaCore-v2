import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

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

  it('no hay tokens/JWT embebidos en el cliente de login', () => {
    for (const src of [loginForm, landing, supabaseLib]) {
      expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
    }
  });
});

describe('Hardening — sin accesos demo / quick-login', () => {
  it('LandingPage no expone Demo Admin ni Accesos Rápidos', () => {
    expect(landing).not.toContain('Demo Admin');
    expect(landing).not.toContain('1-Clic');
    expect(landing).not.toContain('Accesos Rápidos');
    expect(landing).not.toContain('Instancias Demo');
    expect(landing).not.toContain('demo-access');
    expect(landing).not.toContain('handleQuickDemoClick');
  });

  it('LoginForm no muestra Acceso Rápido Staging', () => {
    expect(loginForm).not.toContain('Acceso Rápido');
    expect(loginForm).not.toContain('STAGING_QUICK_LOGINS');
    expect(loginForm).not.toContain('isQuickLoginEnabled');
    expect(loginForm).not.toContain('handleAutoFill');
  });

  it('supabase.ts ya no exporta quick-login staging', () => {
    expect(supabaseLib).not.toContain('STAGING_QUICK_LOGINS');
    expect(supabaseLib).not.toContain('isQuickLoginEnabled');
    expect(supabaseLib).not.toContain('VITE_ENABLE_QUICK_LOGIN');
  });

  it('Landing ofrece registro WISP profesional', () => {
    expect(landing).toContain('Registrar mi WISP');
    expect(landing).toContain('onEnterRegister');
  });
});

describe('Hardening — sin bypass de autenticación', () => {
  it('LandingPage ya no expone onInstantDemo', () => {
    expect(landing).not.toContain('onInstantDemo');
  });

  it('App.tsx ya no cablea un instant-demo', () => {
    expect(appTsx).not.toContain('onInstantDemo');
  });

  it('el modo sin Supabase NO inicia sesión: muestra error', () => {
    expect(loginForm).not.toContain('Simulando acceso exitoso');
    expect(loginForm).toContain('backend de autenticación no está configurado');
  });

  it('App gatea onboarding WISP obligatorio', () => {
    expect(appTsx).toContain('WispOnboardingWizard');
    expect(appTsx).toContain('onboardingRequired');
    expect(appTsx).toContain('RegisterWispForm');
  });

  it('App no hace poll de /api/alerts durante onboarding WISP', () => {
    // refreshAlerts debe cortar antes del fetch cuando onboardingRequired.
    expect(appTsx).toMatch(
      /refreshAlerts[\s\S]{0,400}onboardingRequired[\s\S]{0,80}return/,
    );
    expect(appTsx).toContain("fetchJson<NocAlert[]>('/api/alerts')");
  });

  it('LoginForm expone recuperación de contraseña y no reenvío de confirmación', () => {
    expect(loginForm).toContain('resetPasswordForEmail');
    expect(loginForm).toContain('¿Olvidaste tu contraseña?');
    // Reenviar confirmación solo en RegisterWispForm (post-alta), no en login.
    expect(loginForm).not.toContain('Reenviar confirmación');
    expect(loginForm).not.toContain('login-resend-confirmation');
  });

  it('LoginForm no entra con perfil fake si /api/auth/me falla', () => {
    expect(loginForm).toContain('No se pudo validar la sesión con el servidor');
    expect(loginForm).not.toContain("role: 'Solo lectura'");
  });

  it('App maneja reset de contraseña vía enlace Supabase', () => {
    expect(appTsx).toContain('ResetPasswordForm');
    expect(appTsx).toContain('PASSWORD_RECOVERY');
    expect(appTsx).toContain('/reset-password');
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
