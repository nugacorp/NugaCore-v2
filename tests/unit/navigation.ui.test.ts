import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// UX Reorganization (pre PROD-4) — contrato de navegación del sidebar.
//
// Verifica que:
//  - El sidebar se agrupa en las 6 secciones nuevas, en orden.
//  - Cada módulo existente queda en su sección correcta.
//  - NO se elimina ningún módulo (los 21 tabs siguen presentes).
//  - El sidebar ya no RENDERIZA badges de estado (sin campo `badge`,
//    sin `getBadgeClasses`) ni usa anidamiento `parentId`.
//  - WireGuard y Suspension quedan desacoplados del MikroTik Workspace
//    in-page de App.tsx.
// ====================================================================

const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

// Estructura objetivo: 6 secciones con sus módulos (ids existentes).
const EXPECTED_SECTIONS: Array<{ title: string; ids: string[] }> = [
  { title: 'Dashboard', ids: ['dashboard', 'noc'] },
  { title: 'Clientes', ids: ['crm', 'billing', 'payments', 'suspension', 'support'] },
  { title: 'Red', ids: ['network', 'gis', 'inventory', 'inventory-routers', 'wireguard'] },
  {
    title: 'MikroTik Workspace',
    ids: [
      'mikrotik',
      'router-enrollment',
      'routeros-templates',
      'routeros-resources',
      'routeros-readonly',
      'manual-safe-mode',
      'safe-command-queue',
    ],
  },
  { title: 'Operaciones', ids: ['finance'] },
  { title: 'Administración', ids: ['owner'] },
];

const ALL_TAB_IDS = EXPECTED_SECTIONS.flatMap((s) => s.ids);

// Bloque de fuente de una sección: desde su `title: '...'` hasta el inicio del
// siguiente `title: '...'` (o el final del archivo).
function sectionBlock(title: string): string {
  const marker = `title: '${title}'`;
  const start = sidebarSource.indexOf(marker);
  if (start === -1) return '';
  const rest = sidebarSource.slice(start + marker.length);
  const next = rest.search(/title: '/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('Sidebar — secciones reorganizadas', () => {
  it('define las 6 secciones nuevas en orden', () => {
    let cursor = -1;
    for (const { title } of EXPECTED_SECTIONS) {
      const idx = sidebarSource.indexOf(`title: '${title}'`);
      expect(idx, `falta la sección "${title}"`).toBeGreaterThan(-1);
      expect(idx, `la sección "${title}" está fuera de orden`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('ya NO usa las secciones antiguas (Operations / Management / System)', () => {
    expect(sidebarSource).not.toContain("title: 'Operations'");
    expect(sidebarSource).not.toContain("title: 'Management'");
    expect(sidebarSource).not.toContain("title: 'System'");
  });

  for (const section of EXPECTED_SECTIONS) {
    it(`la sección "${section.title}" contiene sus módulos`, () => {
      const block = sectionBlock(section.title);
      expect(block, `bloque vacío para "${section.title}"`).not.toBe('');
      for (const id of section.ids) {
        expect(block, `"${section.title}" debería incluir ${id}`).toContain(`id: '${id}'`);
      }
    });
  }
});

describe('Sidebar — no se elimina ningún módulo', () => {
  it('los 21 módulos existentes siguen presentes', () => {
    expect(ALL_TAB_IDS.length).toBe(21);
    for (const id of ALL_TAB_IDS) {
      expect(sidebarSource, `falta el módulo ${id} en el sidebar`).toContain(`id: '${id}'`);
    }
  });

  it('cubre todos los tabs declarados en el RBAC (AppTab)', () => {
    for (const id of ALL_TAB_IDS) {
      expect(rbacSource, `${id} debería existir en el union AppTab`).toContain(`'${id}'`);
    }
  });
});

describe('Sidebar — sin badges renderizados ni anidamiento', () => {
  it('no renderiza badges de estado en el sidebar (sin campo badge ni helper)', () => {
    // Los badges viven dentro de cada módulo; el sidebar no los pinta.
    expect(sidebarSource).not.toContain('item.badge');
    expect(sidebarSource).not.toContain('getBadgeClasses');
    expect(sidebarSource).not.toContain('badgeTone');
  });

  it('usa estructura plana por secciones (sin anidamiento parentId)', () => {
    expect(sidebarSource).not.toContain('parentId');
  });

  it('conserva los indicadores dinámicos (alertas de red y tickets abiertos)', () => {
    expect(sidebarSource).toContain('activeAlertsCount');
    expect(sidebarSource).toContain('activeTicketsCount');
  });
});

describe('App — MikroTik Workspace in-page desacoplado', () => {
  function workspaceConstBlock(): string {
    const start = appSource.indexOf('const MIKROTIK_WORKSPACE_TABS');
    const end = appSource.indexOf('] as const;', start);
    return start === -1 || end === -1 ? '' : appSource.slice(start, end);
  }

  it('el workspace in-page solo agrupa funciones de router', () => {
    const block = workspaceConstBlock();
    expect(block).not.toBe('');
    for (const id of ['mikrotik', 'router-enrollment', 'routeros-resources', 'routeros-templates']) {
      expect(block, `el workspace debería incluir ${id}`).toContain(`id: '${id}'`);
    }
  });

  it('WireGuard y Suspension ya NO están anidados en el workspace in-page', () => {
    const block = workspaceConstBlock();
    expect(block).not.toContain("id: 'wireguard'");
    expect(block).not.toContain("id: 'suspension'");
  });
});
