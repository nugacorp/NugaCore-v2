import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// UI/RBAC del inventario de routers. Inventario de consulta + acciones
// de alta/verificar/eliminar (admin) desde un solo módulo.
// ====================================================================

const module = readFileSync('src/components/InventoryRoutersModule.tsx', 'utf8');
const rbac = readFileSync('src/lib/rbac.ts', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((l) => l.includes(needle)) ?? '';

describe('InventoryRoutersModule — inventario + acciones', () => {
  it('marca la vista como INVENTARIO (gestión en un solo lugar)', () => {
    expect(module).toContain('INVENTARIO');
    expect(module).toContain('Sistema → Routers');
  });

  it('consume summary/routers y DELETE de mikrotik para eliminar', () => {
    expect(module).toContain('/api/inventory/summary');
    expect(module).toContain('/api/inventory/routers');
    expect(module).toContain('/api/mikrotik/routers/');
    expect(module).toContain('api.delete');
  });

  it('expone Verificar, Reparar API y Eliminar en Acciones', () => {
    expect(module).toContain('Acciones');
    expect(module).toContain('Eliminar');
    expect(module).toContain('Verificar');
    expect(module).toContain('Reparar API');
    expect(module).toContain('/repair-api');
    expect(module).toContain('canRevokeEnrollment');
  });

  it('renderiza las columnas principales del router', () => {
    for (const col of [
      'Nombre',
      'Estado',
      'Provisioning',
      'Conexión',
      'IP gestión',
      'IP VPN',
      'RouterOS',
      'Last seen',
    ]) {
      expect(module, `falta columna ${col}`).toContain(col);
    }
  });

  it('tiene empty state cuando no hay routers', () => {
    expect(module).toContain('No hay routers en el inventario');
  });

  it('embebidos el alta con Dar de alta', () => {
    expect(module).toContain('Dar de alta');
    expect(module).toContain('RouterEnrollmentWizard');
  });
});

describe('RBAC — visibilidad del tab inventory-routers', () => {
  it('es visible para los roles de operación', () => {
    for (const role of [
      "'Super Admin'",
      "'Administrador'",
      "'Técnico'",
      "'Soporte'",
      "'Solo lectura'",
    ]) {
      expect(lineWith(rbac, role), `${role} debería ver inventory-routers`).toContain(
        'inventory-routers',
      );
    }
  });

  it('NO es visible para Cobranza', () => {
    expect(lineWith(rbac, "'Cobranza'")).not.toContain('inventory-routers');
  });

  it('está declarado en el tipo AppTab y en las etiquetas', () => {
    expect(rbac).toContain("| 'inventory-routers'");
    expect(rbac).toContain("'inventory-routers': 'Routers'");
  });

  it('está en Sistema (no sección MikroTik aparte)', () => {
    expect(sidebar).toContain("id: 'inventory-routers'");
    expect(sidebar).toContain("title: 'Sistema'");
    expect(sidebar).not.toContain("title: 'MikroTik'");
    const sistemaIdx = sidebar.indexOf("title: 'Sistema'");
    const routersIdx = sidebar.indexOf("id: 'inventory-routers'");
    expect(routersIdx).toBeGreaterThan(sistemaIdx);
  });
});
