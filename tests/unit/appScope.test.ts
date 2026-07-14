import { describe, expect, it } from 'vitest';
import type { UserRole } from '../../src/lib/supabase';
import {
  parseAppScope,
  resolveEntryTab,
  manifestPathForScope,
  type AppScope,
} from '../../src/lib/appScope';

// ====================================================================
// App Scope — fundación PWA multi-app (Fase A). Solo lógica pura; el acceso a
// window/sessionStorage vive en getAppScope() y no se ejercita aquí (node env).
// ====================================================================

describe('parseAppScope', () => {
  it('acepta los scopes válidos', () => {
    expect(parseAppScope('admin')).toBe('admin');
    expect(parseAppScope('tech')).toBe('tech');
    expect(parseAppScope('portal')).toBe('portal');
  });

  it('cae a admin ante valores inválidos, vacíos o ausentes', () => {
    expect(parseAppScope('otro')).toBe('admin');
    expect(parseAppScope('')).toBe('admin');
    expect(parseAppScope(null)).toBe('admin');
    expect(parseAppScope(undefined)).toBe('admin');
  });
});

describe('manifestPathForScope', () => {
  it('mapea cada scope a su manifest', () => {
    expect(manifestPathForScope('admin')).toBe('/manifest.json');
    expect(manifestPathForScope('tech')).toBe('/manifest.tech.json');
    expect(manifestPathForScope('portal')).toBe('/manifest.portal.json');
  });
});

describe('resolveEntryTab', () => {
  it('scope admin usa el default del rol (retrocompatible)', () => {
    const roles: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];
    for (const role of roles) {
      expect(resolveEntryTab(role, 'admin')).toBe('dashboard');
    }
  });

  it('scope tech abre en la App de Técnicos para roles con acceso', () => {
    const withTech: UserRole[] = ['Super Admin', 'Administrador', 'Técnico', 'Soporte'];
    for (const role of withTech) {
      expect(resolveEntryTab(role, 'tech')).toBe('tech-pwa');
    }
  });

  it('scope tech cae al default si el rol no puede ver la app de técnicos', () => {
    // 'Cobranza' no tiene 'tech-pwa' en su lista de tabs.
    expect(resolveEntryTab('Cobranza', 'tech')).toBe('dashboard');
  });

  it('scope portal abre en el Portal del Cliente (accesible por todos los roles)', () => {
    const roles: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];
    for (const role of roles) {
      expect(resolveEntryTab(role, 'portal')).toBe('portal');
    }
  });

  it('los scopes conocidos cubren el tipo AppScope', () => {
    const all: AppScope[] = ['admin', 'tech', 'portal'];
    expect(all).toHaveLength(3);
  });
});
