import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Fase 4.11.1 — UI/RBAC del Inventory Read-Only (scan de fuente, mismo
// patrón que mikrotik.modes-ui). Verifica que el módulo es read-only, se
// muestra a los roles de operación y NO a Cobranza.
// ====================================================================

const module = readFileSync('src/components/InventoryRoutersModule.tsx', 'utf8');
const rbac = readFileSync('src/lib/rbac.ts', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');

const lineWith = (src: string, needle: string): string =>
  src.split('\n').find((l) => l.includes(needle)) ?? '';

describe('InventoryRoutersModule — read-only', () => {
  it('marca explícitamente la vista como READ-ONLY', () => {
    expect(module).toContain('READ-ONLY');
  });

  it('consume solo los endpoints read-only de inventory', () => {
    expect(module).toContain('/api/inventory/summary');
    expect(module).toContain('/api/inventory/routers');
  });

  it('no realiza llamadas de escritura (POST/PUT/DELETE/PATCH)', () => {
    expect(module).not.toMatch(/method:\s*['"](POST|PUT|DELETE|PATCH)['"]/i);
  });

  it('renderiza las columnas principales del router', () => {
    for (const col of ['Nombre', 'Estado', 'Provisioning', 'Conexión', 'IP gestión', 'IP VPN', 'RouterOS', 'Last seen']) {
      expect(module, `falta columna ${col}`).toContain(col);
    }
  });

  it('tiene empty state cuando no hay routers', () => {
    expect(module).toContain('No hay routers en el inventario');
  });
});

describe('RBAC — visibilidad del tab inventory-routers', () => {
  it('es visible para los roles de operación', () => {
    for (const role of ["'Super Admin'", "'Administrador'", "'Técnico'", "'Soporte'", "'Solo lectura'"]) {
      expect(lineWith(rbac, role), `${role} debería ver inventory-routers`).toContain('inventory-routers');
    }
  });

  it('NO es visible para Cobranza', () => {
    expect(lineWith(rbac, "'Cobranza'")).not.toContain('inventory-routers');
  });

  it('está declarado en el tipo AppTab y en las etiquetas', () => {
    expect(rbac).toContain("| 'inventory-routers'");
    expect(rbac).toContain("'inventory-routers': 'Inventario Routers (RO)'");
  });

  it('está en el menú lateral', () => {
    expect(sidebar).toContain("id: 'inventory-routers'");
  });
});
