import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { canAccessTab, getAllowedTabsByRole, getDefaultTabByRole } from '../../src/lib/rbac';
import type { UserRole } from '../../src/lib/supabase';

const ALL_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];

describe('RBAC visual por rol (frontend)', () => {
  it('Super Admin ve todos los módulos (15)', () => {
    const t = getAllowedTabsByRole('Super Admin');
    expect(t.length).toBe(15);
    expect(t).toEqual(expect.arrayContaining(['mikrotik', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'owner', 'finance', 'billing', 'inventory', 'suspension']));
  });

  it('Administrador NO ve mikrotik / finance / owner', () => {
    const t = getAllowedTabsByRole('Administrador');
    expect(t).toEqual(expect.arrayContaining(['dashboard', 'crm', 'billing', 'network', 'support', 'inventory', 'gis']));
    expect(t).not.toContain('mikrotik');
    expect(t).not.toContain('finance');
    expect(t).not.toContain('owner');
  });

  it('Cobranza ve billing/finance; no mikrotik ni red', () => {
    expect(getAllowedTabsByRole('Cobranza')).toEqual(['dashboard', 'crm', 'billing', 'finance', 'suspension']);
    expect(canAccessTab('Cobranza', 'mikrotik')).toBe(false);
    expect(canAccessTab('Cobranza', 'network')).toBe(false);
  });

  it('Técnico ve red/mikrotik/soporte; no finanzas ni billing', () => {
    const t = getAllowedTabsByRole('Técnico');
    expect(t).toEqual(expect.arrayContaining(['network', 'mikrotik', 'support', 'inventory', 'gis']));
    expect(t).not.toContain('finance');
    expect(t).not.toContain('billing');
  });

  it('Soporte: dashboard/crm/support/gis; no billing ni mikrotik', () => {
    expect(getAllowedTabsByRole('Soporte')).toEqual(['dashboard', 'crm', 'support', 'gis']);
    expect(canAccessTab('Soporte', 'billing')).toBe(false);
    expect(canAccessTab('Soporte', 'mikrotik')).toBe(false);
  });

  it('Solo lectura: solo lectura; sin mikrotik/support/inventory/owner', () => {
    expect(getAllowedTabsByRole('Solo lectura')).toEqual(['dashboard', 'crm', 'billing', 'suspension', 'network', 'gis']);
    expect(canAccessTab('Solo lectura', 'mikrotik')).toBe(false);
    expect(canAccessTab('Solo lectura', 'owner')).toBe(false);
    expect(canAccessTab('Solo lectura', 'support')).toBe(false);
  });

  it('rol desconocido / sin rol -> fallback Solo lectura', () => {
    const unknown = getAllowedTabsByRole('NoExiste' as unknown as UserRole);
    expect(unknown).toEqual(getAllowedTabsByRole('Solo lectura'));
  });

  it('default = primer módulo permitido (dashboard) y siempre accesible', () => {
    for (const r of ALL_ROLES) {
      const def = getDefaultTabByRole(r);
      expect(def).toBe('dashboard');
      expect(canAccessTab(r, def)).toBe(true);
    }
  });

  it('redirección: un tab no permitido cae a un módulo permitido', () => {
    // Simula el efecto de App: si !canAccessTab -> getDefaultTabByRole
    const role: UserRole = 'Solo lectura';
    const target = 'mikrotik';
    const next = canAccessTab(role, target) ? target : getDefaultTabByRole(role);
    expect(next).toBe('dashboard');
    expect(canAccessTab(role, next)).toBe(true);
  });

  it('routeros-templates visible para Super Admin, Administrador, Técnico', () => {
    expect(canAccessTab('Super Admin',  'routeros-templates')).toBe(true);
    expect(canAccessTab('Administrador','routeros-templates')).toBe(true);
    expect(canAccessTab('Técnico',      'routeros-templates')).toBe(true);
  });

  it('routeros-templates NO visible para Cobranza, Soporte, Solo lectura', () => {
    expect(canAccessTab('Cobranza',    'routeros-templates')).toBe(false);
    expect(canAccessTab('Soporte',     'routeros-templates')).toBe(false);
    expect(canAccessTab('Solo lectura','routeros-templates')).toBe(false);
  });

  it('router-enrollment visible para Super Admin, Administrador, Técnico', () => {
    expect(canAccessTab('Super Admin',   'router-enrollment')).toBe(true);
    expect(canAccessTab('Administrador', 'router-enrollment')).toBe(true);
    expect(canAccessTab('Técnico',       'router-enrollment')).toBe(true);
  });

  it('router-enrollment NO visible para Cobranza, Soporte, Solo lectura', () => {
    expect(canAccessTab('Cobranza',     'router-enrollment')).toBe(false);
    expect(canAccessTab('Soporte',      'router-enrollment')).toBe(false);
    expect(canAccessTab('Solo lectura', 'router-enrollment')).toBe(false);
  });

  it('App no dispara fetchData antes de tener sesión validada', () => {
    // Regresión del bug: el dashboard hacía llamadas a /api/* en mount sin Bearer,
    // causando spam de 401 antes/después del login.
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(app).toContain('if (!sessionBootstrapped || !userSession)');
    expect(app).toContain('}, [sessionBootstrapped, userSession?.id]);');
  });
});
