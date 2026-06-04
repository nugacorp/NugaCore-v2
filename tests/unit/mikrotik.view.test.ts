import { describe, it, expect } from 'vitest';
import { connectionTypeLabel, statusBadge, clipboardScript } from '../../src/lib/mikrotikView';
import { canManageRouters, canGenerateScript, canRotateCredentials } from '../../src/lib/mikrotikRbac';
import type { UserRole } from '../../src/lib/supabase';

// ====================================================================
// Fase 4.4 — helpers de presentación + RBAC visual MikroTik.
// ====================================================================

describe('mikrotikView', () => {
  it('etiqueta los tipos de conexión', () => {
    expect(connectionTypeLabel('wireguard')).toContain('WireGuard');
    expect(connectionTypeLabel('sstp')).toContain('SSTP');
  });

  it('deriva el badge de estado', () => {
    expect(statusBadge('connected').tone).toBe('connected');
    expect(statusBadge('provisioned').tone).toBe('provisioned');
    expect(statusBadge('pending').tone).toBe('pending');
    expect(statusBadge('error').tone).toBe('error');
  });

  it('clipboardScript copia SOLO el script (sin token)', () => {
    const script = '# NugaCore script\n/user add ...';
    expect(clipboardScript({ script })).toBe(script);
  });
});

describe('mikrotikRbac (botones por rol)', () => {
  it('crear/editar: solo Super Admin y Administrador', () => {
    expect(canManageRouters('Super Admin')).toBe(true);
    expect(canManageRouters('Administrador')).toBe(true);
    expect(canManageRouters('Técnico')).toBe(false);
    expect(canManageRouters('Cobranza')).toBe(false);
  });

  it('generar script/test: Super Admin, Administrador y Técnico', () => {
    expect(canGenerateScript('Técnico')).toBe(true);
    expect(canGenerateScript('Soporte')).toBe(false);
    expect(canGenerateScript('Cobranza')).toBe(false);
  });

  it('rotar credenciales: solo Super Admin y Administrador', () => {
    expect(canRotateCredentials('Administrador')).toBe(true);
    expect(canRotateCredentials('Técnico')).toBe(false);
  });

  it('rol nulo → sin permisos', () => {
    const none = null as unknown as UserRole;
    expect(canManageRouters(none)).toBe(false);
    expect(canGenerateScript(none)).toBe(false);
  });
});
