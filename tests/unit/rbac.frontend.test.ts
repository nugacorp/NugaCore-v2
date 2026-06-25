import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { canAccessTab, getAllowedTabsByRole, getDefaultTabByRole, isVisibleInSidebar, isSidebarHiddenTab } from '../../src/lib/rbac';
import type { UserRole } from '../../src/lib/supabase';

const ALL_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];

describe('RBAC visual por rol (frontend)', () => {
  it('Super Admin ve todos los módulos (24)', () => {
    const t = getAllowedTabsByRole('Super Admin');
    expect(t.length).toBe(24);
    expect(t).toEqual(expect.arrayContaining(['mikrotik', 'wireguard', 'routeros-resources', 'routeros-templates', 'router-enrollment', 'payments', 'owner', 'finance', 'billing', 'inventory', 'inventory-routers', 'suspension', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'user-manual']));
  });

  it('Administrador NO ve mikrotik / finance / owner', () => {
    const t = getAllowedTabsByRole('Administrador');
    expect(t).toEqual(expect.arrayContaining(['dashboard', 'crm', 'billing', 'network', 'support', 'inventory', 'gis']));
    expect(t).not.toContain('mikrotik');
    expect(t).not.toContain('finance');
    expect(t).not.toContain('owner');
  });

  it('Cobranza ve billing/finance/payments; no mikrotik, red ni inventory-routers', () => {
    expect(getAllowedTabsByRole('Cobranza')).toEqual(['dashboard', 'crm', 'billing', 'finance', 'suspension', 'payments', 'provisioning', 'user-manual']);
    expect(canAccessTab('Cobranza', 'mikrotik')).toBe(false);
    expect(canAccessTab('Cobranza', 'network')).toBe(false);
    expect(canAccessTab('Cobranza', 'inventory-routers')).toBe(false);
  });

  it('Técnico ve alta de clientes/red/mikrotik/soporte; no finanzas ni billing', () => {
    const t = getAllowedTabsByRole('Técnico');
    expect(t).toEqual(expect.arrayContaining(['crm', 'network', 'mikrotik', 'support', 'inventory', 'gis']));
    expect(t).not.toContain('finance');
    expect(t).not.toContain('billing');
  });

  it('Soporte: dashboard/noc/crm/support/inventory-routers/gis; no billing ni mikrotik', () => {
    expect(getAllowedTabsByRole('Soporte')).toEqual(['dashboard', 'noc', 'crm', 'support', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'user-manual']);
    expect(canAccessTab('Soporte', 'billing')).toBe(false);
    expect(canAccessTab('Soporte', 'mikrotik')).toBe(false);
    expect(canAccessTab('Soporte', 'inventory-routers')).toBe(true);
  });

  it('Solo lectura: lectura básica + noc + inventory-routers; sin mikrotik/support/owner', () => {
    expect(getAllowedTabsByRole('Solo lectura')).toEqual(['dashboard', 'noc', 'crm', 'billing', 'suspension', 'network', 'inventory-routers', 'gis', 'manual-safe-mode', 'safe-command-queue', 'routeros-readonly', 'inventory-sync', 'provisioning', 'user-manual']);
    expect(canAccessTab('Solo lectura', 'mikrotik')).toBe(false);
    expect(canAccessTab('Solo lectura', 'owner')).toBe(false);
    expect(canAccessTab('Solo lectura', 'support')).toBe(false);
    expect(canAccessTab('Solo lectura', 'inventory-routers')).toBe(true);
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

  it('manual-safe-mode visible para SA, Admin, Técnico, Soporte, Solo lectura', () => {
    for (const r of ['Super Admin', 'Administrador', 'Técnico', 'Soporte', 'Solo lectura'] as UserRole[]) {
      expect(canAccessTab(r, 'manual-safe-mode'), `${r} debería ver manual-safe-mode`).toBe(true);
    }
  });

  it('manual-safe-mode NO visible para Cobranza', () => {
    expect(canAccessTab('Cobranza', 'manual-safe-mode')).toBe(false);
  });

  it('safe-command-queue visible para SA, Admin, Técnico, Soporte, Solo lectura', () => {
    for (const r of ['Super Admin', 'Administrador', 'Técnico', 'Soporte', 'Solo lectura'] as UserRole[]) {
      expect(canAccessTab(r, 'safe-command-queue'), `${r} debería ver safe-command-queue`).toBe(true);
    }
  });

  it('safe-command-queue NO visible para Cobranza', () => {
    expect(canAccessTab('Cobranza', 'safe-command-queue')).toBe(false);
  });

  it('routeros-readonly visible para SA, Admin, Técnico, Soporte, Solo lectura', () => {
    for (const r of ['Super Admin', 'Administrador', 'Técnico', 'Soporte', 'Solo lectura'] as UserRole[]) {
      expect(canAccessTab(r, 'routeros-readonly'), `${r} debería ver routeros-readonly`).toBe(true);
    }
  });

  it('routeros-readonly NO visible para Cobranza', () => {
    expect(canAccessTab('Cobranza', 'routeros-readonly')).toBe(false);
  });

  it('App no dispara fetchData antes de tener sesión validada', () => {
    // Regresión del bug: el dashboard hacía llamadas a /api/* en mount sin Bearer,
    // causando spam de 401 antes/después del login.
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(app).toContain('if (!sessionBootstrapped || !userSession)');
    expect(app).toContain('[sessionBootstrapped, userSession?.id');
  });

  it('App pausa polling cuando la pestaña no está visible y limpia listeners', () => {
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(app).toContain("document.visibilityState !== 'visible'");
    expect(app).toContain("document.addEventListener('visibilitychange'");
    expect(app).toContain("document.removeEventListener('visibilitychange'");
  });

  it('App carga solo el dataset de la vista activa para no agotar rate-limit', () => {
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(app).not.toContain('shouldPollCoreDataset');
    expect(app).toContain("activeTab === 'dashboard'");
    expect(app).toContain("activeTab === 'network'");
    expect(app).toContain('Carga solo el dataset que necesita la vista activa');
  });

  it('App respeta cooldown de 429 para evitar loops de polling agresivo', () => {
    const app = readFileSync('src/App.tsx', 'utf8');

    expect(app).toContain('rateLimitUntilMs');
    expect(app).toContain('Date.now() < rateLimitUntilMs');
  });
});

describe('Manual de Usuario — visible para todos los roles', () => {
  it('está permitido (canAccessTab) para cada rol', () => {
    for (const r of ALL_ROLES) {
      expect(canAccessTab(r, 'user-manual'), `${r} debería poder ver user-manual`).toBe(true);
    }
  });

  it('es visible en el sidebar para cada rol, incluida Cobranza', () => {
    for (const r of ALL_ROLES) {
      expect(isVisibleInSidebar(r, 'user-manual'), `${r} debería ver user-manual en el sidebar`).toBe(true);
    }
    expect(isVisibleInSidebar('Cobranza', 'user-manual')).toBe(true);
  });
});

describe('Visibilidad en sidebar ≠ acceso (módulos internos ocultos)', () => {
  const HIDDEN = ['wireguard', 'manual-safe-mode', 'safe-command-queue'] as const;

  it('isSidebarHiddenTab marca exactamente los 3 módulos internos', () => {
    for (const id of HIDDEN) {
      expect(isSidebarHiddenTab(id), `${id} debería estar oculto`).toBe(true);
    }
    for (const id of ['dashboard', 'crm', 'mikrotik', 'inventory-routers', 'user-manual']) {
      expect(isSidebarHiddenTab(id), `${id} NO debería estar oculto`).toBe(false);
    }
  });

  it('Super Admin: módulos internos accesibles pero ocultos del sidebar', () => {
    for (const id of HIDDEN) {
      expect(canAccessTab('Super Admin', id), `${id} accesible`).toBe(true);
      expect(isVisibleInSidebar('Super Admin', id), `${id} oculto en sidebar`).toBe(false);
    }
  });

  it('isVisibleInSidebar respeta el RBAC: false si el rol no tiene acceso', () => {
    // Cobranza no tiene mikrotik → ni accesible ni visible.
    expect(canAccessTab('Cobranza', 'mikrotik')).toBe(false);
    expect(isVisibleInSidebar('Cobranza', 'mikrotik')).toBe(false);
    // Un módulo normal sí permitido a Cobranza es visible.
    expect(isVisibleInSidebar('Cobranza', 'billing')).toBe(true);
  });
});
