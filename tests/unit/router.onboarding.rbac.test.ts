import { describe, it, expect } from 'vitest';
import { canStartRouterOnboarding } from '../../src/lib/routerOnboardingRbac';
import type { UserRole } from '../../src/lib/supabase';

const ALLOWED: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
const BLOCKED: UserRole[] = ['Cobranza', 'Soporte', 'Solo lectura'];

describe('canStartRouterOnboarding — roles permitidos', () => {
  it('Super Admin puede iniciar onboarding', () => {
    expect(canStartRouterOnboarding('Super Admin')).toBe(true);
  });

  it('Administrador puede iniciar onboarding', () => {
    expect(canStartRouterOnboarding('Administrador')).toBe(true);
  });

  it('Técnico puede iniciar onboarding', () => {
    expect(canStartRouterOnboarding('Técnico')).toBe(true);
  });
});

describe('canStartRouterOnboarding — roles bloqueados', () => {
  it('Cobranza NO puede iniciar onboarding', () => {
    expect(canStartRouterOnboarding('Cobranza')).toBe(false);
  });

  it('Soporte NO puede iniciar onboarding', () => {
    expect(canStartRouterOnboarding('Soporte')).toBe(false);
  });

  it('Solo lectura NO puede iniciar onboarding', () => {
    expect(canStartRouterOnboarding('Solo lectura')).toBe(false);
  });
});

describe('canStartRouterOnboarding — normalización case-insensitive', () => {
  it('acepta "super admin" en minúsculas', () => {
    expect(canStartRouterOnboarding('super admin')).toBe(true);
  });

  it('acepta "técnico" en minúsculas', () => {
    expect(canStartRouterOnboarding('técnico')).toBe(true);
  });

  it('acepta "ADMINISTRADOR" en mayúsculas', () => {
    expect(canStartRouterOnboarding('ADMINISTRADOR')).toBe(true);
  });

  it('acepta "  Super Admin  " con espacios extra (trim)', () => {
    expect(canStartRouterOnboarding('  Super Admin  ')).toBe(true);
  });
});

describe('canStartRouterOnboarding — edge cases', () => {
  it('null devuelve false', () => {
    expect(canStartRouterOnboarding(null)).toBe(false);
  });

  it('undefined devuelve false', () => {
    expect(canStartRouterOnboarding(undefined)).toBe(false);
  });

  it('cadena vacía devuelve false', () => {
    expect(canStartRouterOnboarding('')).toBe(false);
  });

  it('rol desconocido devuelve false', () => {
    expect(canStartRouterOnboarding('Owner')).toBe(false);
  });
});

describe('canStartRouterOnboarding — tipado UserRole', () => {
  it('todos los roles permitidos devuelven true', () => {
    for (const role of ALLOWED) {
      expect(canStartRouterOnboarding(role), `rol "${role}" debería poder iniciar onboarding`).toBe(true);
    }
  });

  it('todos los roles bloqueados devuelven false', () => {
    for (const role of BLOCKED) {
      expect(canStartRouterOnboarding(role), `rol "${role}" NO debería poder iniciar onboarding`).toBe(false);
    }
  });
});
