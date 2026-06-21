import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAccessTab, isVisibleInSidebar, getModuleLabel } from '../../src/lib/rbac';
import type { UserRole } from '../../src/lib/supabase';

// ====================================================================
// Manual de Usuario — contrato de UI (100% frontend, sin backend/APIs).
// ====================================================================

const moduleSource = readFileSync('src/modules/user-manual/UserManualModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');

const ALL_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Cobranza', 'Técnico', 'Soporte', 'Solo lectura'];

describe('UserManualModule — contrato de contenido', () => {
  it('muestra título y descripción', () => {
    expect(moduleSource).toContain('Manual de Usuario');
    expect(moduleSource).toContain('Guía rápida para operar NugaCore.');
  });

  it('incluye las secciones básicas de la guía', () => {
    for (const label of [
      'Inicio / Dashboard',
      'Clientes',
      'Tickets',
      'Facturación y Planes',
      'Pagos',
      'Suspensiones',
      'Red WISP',
      'MikroTik / Routers',
      'Alta de Router',
      'Plantillas y Scripts',
      'RouterOS Lab',
      'NOC',
    ]) {
      expect(moduleSource, `falta la sección "${label}"`).toContain(label);
    }
  });

  it('aclara que WireGuard, Safe Mode y Command Queue no son módulos operativos normales', () => {
    expect(moduleSource).toContain(
      'Las funciones internas de seguridad como WireGuard, Safe Mode y Command Queue no están',
    );
  });

  it('no hace llamadas a backend (sin fetch / endpoints)', () => {
    expect(moduleSource).not.toContain('fetch(');
    expect(moduleSource).not.toContain('/api/');
  });
});

describe('UserManualModule — integración', () => {
  it('App importa y renderiza el módulo cuando el tab está activo', () => {
    expect(appSource).toContain("import UserManualModule from './modules/user-manual/UserManualModule'");
    expect(appSource).toContain("activeTab === 'user-manual'");
    expect(appSource).toContain('<UserManualModule');
  });

  it('aparece en el sidebar con su nombre', () => {
    expect(sidebarSource).toContain("id: 'user-manual'");
    expect(sidebarSource).toContain('Manual de Usuario');
  });

  it('tiene etiqueta legible en rbac (MODULE_LABELS)', () => {
    expect(getModuleLabel('user-manual')).toBe('Manual de Usuario');
  });
});

describe('UserManualModule — visible para todos los roles', () => {
  it('accesible y visible para cada rol (incluida Cobranza)', () => {
    for (const r of ALL_ROLES) {
      expect(canAccessTab(r, 'user-manual'), `${r} acceso`).toBe(true);
      expect(isVisibleInSidebar(r, 'user-manual'), `${r} visible en sidebar`).toBe(true);
    }
  });
});
