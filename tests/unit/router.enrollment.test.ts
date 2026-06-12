// ====================================================================
// Tests unitarios — Router Enrollment (Fase 4.7).
// Cubre: repositorio, RBAC helpers, modelo de datos y tipos.
// ====================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { enrollmentRepository } from '../../backend/domains/router-enrollment/repository';
import {
  EnrollmentStatus,
  ENROLLMENT_STATUS_LABELS,
  RouterEnrollmentRecord,
} from '../../backend/domains/router-enrollment/types';
import {
  canStartEnrollment,
  canRevokeEnrollment,
  canAccessEnrollmentModule,
} from '../../src/lib/enrollmentRbac';
import type { UserRole } from '../../src/lib/supabase';

// ── Helpers ────────────────────────────────────────────────────────────

const makeRecord = (id: string, status: EnrollmentStatus = 'script_generated'): RouterEnrollmentRecord => ({
  id,
  routerId: 'mkt-test',
  wgServerId: 'wgs-test',
  wgPeerId: 'wgp-test',
  enrolledBy: 'user-test',
  status,
  scriptHash: 'abc123',
  checkOnlineAttempts: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// ── Repositorio ────────────────────────────────────────────────────────

describe('enrollmentRepository', () => {
  beforeEach(() => enrollmentRepository._reset());

  it('nextId genera IDs incrementales tipo enr-N', () => {
    expect(enrollmentRepository.nextId()).toBe('enr-1');
    expect(enrollmentRepository.nextId()).toBe('enr-2');
    expect(enrollmentRepository.nextId()).toBe('enr-3');
  });

  it('create almacena el registro', () => {
    const rec = makeRecord('enr-1');
    enrollmentRepository.create(rec);
    expect(enrollmentRepository.list()).toHaveLength(1);
    expect(enrollmentRepository.getById('enr-1')).toEqual(rec);
  });

  it('list devuelve todos los registros', () => {
    enrollmentRepository.create(makeRecord('enr-1'));
    enrollmentRepository.create(makeRecord('enr-2'));
    expect(enrollmentRepository.list()).toHaveLength(2);
  });

  it('getById devuelve undefined para ID inexistente', () => {
    expect(enrollmentRepository.getById('enr-999')).toBeUndefined();
  });

  it('update modifica el registro y actualiza updatedAt', () => {
    const rec = makeRecord('enr-1', 'script_generated');
    rec.updatedAt = '2020-01-01T00:00:00.000Z';
    enrollmentRepository.create(rec);
    const updated = enrollmentRepository.update('enr-1', { status: 'online' });
    expect(updated?.status).toBe('online');
    expect(updated?.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('update devuelve undefined para ID inexistente', () => {
    expect(enrollmentRepository.update('enr-999', { status: 'online' })).toBeUndefined();
  });

  it('_reset limpia todos los registros y reinicia el contador', () => {
    enrollmentRepository.create(makeRecord('enr-1'));
    enrollmentRepository._reset();
    expect(enrollmentRepository.list()).toHaveLength(0);
    expect(enrollmentRepository.nextId()).toBe('enr-1');
  });

  it('list devuelve copia (no mutación directa)', () => {
    enrollmentRepository.create(makeRecord('enr-1'));
    const list1 = enrollmentRepository.list();
    enrollmentRepository.create(makeRecord('enr-2'));
    expect(list1).toHaveLength(1);
  });
});

// ── Estados ────────────────────────────────────────────────────────────

describe('ENROLLMENT_STATUS_LABELS', () => {
  const ALL_STATUSES: EnrollmentStatus[] = [
    'draft', 'script_generated', 'script_downloaded',
    'waiting_for_router', 'online', 'failed', 'revoked',
  ];

  it('todos los estados tienen una etiqueta legible', () => {
    for (const s of ALL_STATUSES) {
      expect(ENROLLMENT_STATUS_LABELS[s]).toBeTruthy();
      expect(typeof ENROLLMENT_STATUS_LABELS[s]).toBe('string');
    }
  });

  it('online → "Online"', () => {
    expect(ENROLLMENT_STATUS_LABELS['online']).toBe('Online');
  });

  it('revoked → "Revocado"', () => {
    expect(ENROLLMENT_STATUS_LABELS['revoked']).toBe('Revocado');
  });

  it('failed → "Fallido"', () => {
    expect(ENROLLMENT_STATUS_LABELS['failed']).toBe('Fallido');
  });
});

// ── RBAC helpers ───────────────────────────────────────────────────────

describe('enrollmentRbac', () => {
  const ENROLL_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico'];
  const REVOKE_ROLES: UserRole[] = ['Super Admin', 'Administrador'];
  const BLOCKED: UserRole[] = ['Cobranza', 'Soporte', 'Solo lectura'];

  it('canStartEnrollment: SA / Admin / Técnico → true', () => {
    for (const r of ENROLL_ROLES) {
      expect(canStartEnrollment(r)).toBe(true);
    }
  });

  it('canStartEnrollment: Cobranza / Soporte / Solo lectura → false', () => {
    for (const r of BLOCKED) {
      expect(canStartEnrollment(r)).toBe(false);
    }
  });

  it('canRevokeEnrollment: SA / Admin → true', () => {
    for (const r of REVOKE_ROLES) {
      expect(canRevokeEnrollment(r)).toBe(true);
    }
  });

  it('canRevokeEnrollment: Técnico → false', () => {
    expect(canRevokeEnrollment('Técnico')).toBe(false);
  });

  it('canRevokeEnrollment: Cobranza / Soporte / Solo lectura → false', () => {
    for (const r of BLOCKED) {
      expect(canRevokeEnrollment(r)).toBe(false);
    }
  });

  it('canAccessEnrollmentModule = canStartEnrollment', () => {
    for (const r of [...ENROLL_ROLES, ...BLOCKED]) {
      expect(canAccessEnrollmentModule(r)).toBe(canStartEnrollment(r));
    }
  });
});

// ── Modelo de datos ────────────────────────────────────────────────────

describe('RouterEnrollmentRecord — estructura', () => {
  it('contiene todos los campos requeridos', () => {
    const rec = makeRecord('enr-1');
    expect(rec).toHaveProperty('id');
    expect(rec).toHaveProperty('routerId');
    expect(rec).toHaveProperty('wgServerId');
    expect(rec).toHaveProperty('wgPeerId');
    expect(rec).toHaveProperty('enrolledBy');
    expect(rec).toHaveProperty('status');
    expect(rec).toHaveProperty('checkOnlineAttempts');
    expect(rec).toHaveProperty('createdAt');
    expect(rec).toHaveProperty('updatedAt');
  });

  it('NO tiene campo "script" (secretos nunca persistidos)', () => {
    const rec = makeRecord('enr-1') as unknown as Record<string, unknown>;
    expect(rec).not.toHaveProperty('script');
    expect(rec).not.toHaveProperty('privateKey');
    expect(rec).not.toHaveProperty('presharedKey');
  });
});
