import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canAccessTab, isVisibleInSidebar, getModuleLabel } from '../../src/lib/rbac';
import type { UserRole } from '../../src/lib/supabase';

// ====================================================================
// PROD-6 Inventory Sync — contrato de UI e integración. Read-only.
// ====================================================================

const moduleSource = readFileSync('src/modules/inventory-sync/InventorySyncModule.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');

const READ_ROLES: UserRole[] = ['Super Admin', 'Administrador', 'Técnico', 'Soporte', 'Solo lectura'];

describe('InventorySyncModule — contrato de UI', () => {
  it('marca la vista como READ ONLY y aclara que no modifica routers', () => {
    expect(moduleSource).toContain('READ ONLY');
    expect(moduleSource).toContain('Esta funcionalidad no modifica routers.');
  });

  it('muestra resumen: última sincronización, diferencias y estado general', () => {
    expect(moduleSource).toContain('Última sincronización');
    expect(moduleSource).toContain('Diferencias');
    expect(moduleSource).toContain('Estado general');
  });

  it('tiene tabla con columnas Tipo / Router / Elemento / Estado', () => {
    for (const header of ['Tipo', 'Router', 'Elemento', 'Estado']) {
      expect(moduleSource, `falta columna ${header}`).toContain(`>${header}<`);
    }
  });

  it('muestra el indicador de Fuente (mock/routeros)', () => {
    expect(moduleSource).toContain('Fuente:');
  });

  it('consume solo endpoints read-only por GET (sin write)', () => {
    expect(moduleSource).toContain("fetch('/api/inventory-sync/status'");
    expect(moduleSource).toContain("fetch('/api/inventory-sync/differences'");
    expect(moduleSource).not.toMatch(/method:\s*['"](POST|PUT|DELETE|PATCH)['"]/i);
  });
});

describe('InventorySyncModule — integración', () => {
  it('App importa y renderiza el módulo cuando el tab está activo', () => {
    expect(appSource).toContain("import InventorySyncModule from './modules/inventory-sync/InventorySyncModule'");
    expect(appSource).toContain("activeTab === 'inventory-sync'");
    expect(appSource).toContain('<InventorySyncModule');
  });

  it('aparece en el sidebar (grupo MikroTik)', () => {
    expect(sidebarSource).toContain("id: 'inventory-sync'");
    expect(sidebarSource).toContain('Inventory Sync');
  });

  it('tiene etiqueta legible en rbac (MODULE_LABELS)', () => {
    expect(getModuleLabel('inventory-sync')).toBe('Inventory Sync (RO)');
  });
});

describe('InventorySyncModule — RBAC visual', () => {
  it('visible para los 5 roles de operación', () => {
    for (const role of READ_ROLES) {
      expect(canAccessTab(role, 'inventory-sync'), `${role} acceso`).toBe(true);
      expect(isVisibleInSidebar(role, 'inventory-sync'), `${role} sidebar`).toBe(true);
    }
  });

  it('NO visible/accesible para Cobranza', () => {
    expect(canAccessTab('Cobranza', 'inventory-sync')).toBe(false);
    expect(isVisibleInSidebar('Cobranza', 'inventory-sync')).toBe(false);
  });
});
