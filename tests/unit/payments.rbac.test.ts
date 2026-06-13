import { describe, it, expect } from 'vitest';
import { canWritePayments } from '../../src/lib/paymentsRbac';
import type { UserRole } from '../../src/lib/supabase';

// ── Roles con acceso de escritura ────────────────────────────────────

describe('canWritePayments — roles con escritura', () => {
  it('Super Admin puede escribir (capitalización estándar)', () => {
    expect(canWritePayments('Super Admin')).toBe(true);
  });

  it('Administrador puede escribir', () => {
    expect(canWritePayments('Administrador')).toBe(true);
  });

  it('Cobranza puede escribir', () => {
    expect(canWritePayments('Cobranza')).toBe(true);
  });
});

// ── Roles bloqueados ─────────────────────────────────────────────────

describe('canWritePayments — roles bloqueados', () => {
  it('Técnico NO puede escribir', () => {
    expect(canWritePayments('Técnico')).toBe(false);
  });

  it('Soporte NO puede escribir', () => {
    expect(canWritePayments('Soporte')).toBe(false);
  });

  it('Solo lectura NO puede escribir', () => {
    expect(canWritePayments('Solo lectura')).toBe(false);
  });
});

// ── Normalización de capitalización ─────────────────────────────────

describe('canWritePayments — normalización case-insensitive', () => {
  it('acepta "super admin" en minúsculas', () => {
    expect(canWritePayments('super admin')).toBe(true);
  });

  it('acepta "administrador" en minúsculas', () => {
    expect(canWritePayments('administrador')).toBe(true);
  });

  it('acepta "cobranza" en minúsculas', () => {
    expect(canWritePayments('cobranza')).toBe(true);
  });

  it('acepta "SUPER ADMIN" en mayúsculas', () => {
    expect(canWritePayments('SUPER ADMIN')).toBe(true);
  });

  it('acepta "  Super Admin  " con espacios extra (trim)', () => {
    expect(canWritePayments('  Super Admin  ')).toBe(true);
  });
});

// ── Casos edge ───────────────────────────────────────────────────────

describe('canWritePayments — casos edge', () => {
  it('null devuelve false', () => {
    expect(canWritePayments(null)).toBe(false);
  });

  it('undefined devuelve false', () => {
    expect(canWritePayments(undefined)).toBe(false);
  });

  it('cadena vacía devuelve false', () => {
    expect(canWritePayments('')).toBe(false);
  });

  it('rol desconocido devuelve false', () => {
    expect(canWritePayments('Owner')).toBe(false);
  });
});

// ── Compatibilidad con UserRole tipado ──────────────────────────────

describe('canWritePayments — tipado UserRole', () => {
  const writableRoles: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza'];
  const readOnlyRoles: UserRole[] = ['Técnico', 'Soporte', 'Solo lectura'];

  it('todos los roles de escritura devuelven true', () => {
    for (const role of writableRoles) {
      expect(canWritePayments(role), `rol "${role}" debería poder escribir`).toBe(true);
    }
  });

  it('todos los roles de solo lectura devuelven false', () => {
    for (const role of readOnlyRoles) {
      expect(canWritePayments(role), `rol "${role}" NO debería poder escribir`).toBe(false);
    }
  });
});
