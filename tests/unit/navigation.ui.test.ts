import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// UX Reorganization WISP (pre PROD-5) — contrato de navegación del sidebar.
//
// Verifica que:
//  - El sidebar se agrupa en las 6 secciones WISP finales, en orden.
//  - Cada módulo VISIBLE queda en su sección correcta.
//  - Routers (`inventory-routers`) vive dentro del grupo MikroTik.
//  - Manual de Usuario (`user-manual`) vive en Sistema.
//  - Los módulos internos (wireguard / manual-safe-mode / safe-command-queue)
//    NO se renderizan en el sidebar, pero SÍ existen en el RBAC (siguen
//    accesibles por tab/URL directo).
//  - El sidebar ya no RENDERIZA badges de estado (sin campo `badge`,
//    sin `getBadgeClasses`) ni usa anidamiento `parentId`.
//  - WireGuard y Suspension quedan desacoplados del MikroTik Workspace
//    in-page de App.tsx.
// ====================================================================

const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

// Estructura WISP OS: 8 secciones con módulos VISIBLES (ids existentes).
const EXPECTED_SECTIONS: Array<{ title: string; ids: string[] }> = [
  { title: 'Control', ids: ['dashboard', 'reports'] },
  { title: 'Clientes', ids: ['crm', 'commercial', 'portal', 'support', 'tech-pwa'] },
  { title: 'Cobranza', ids: ['billing', 'payments', 'suspension'] },
  { title: 'Operaciones', ids: ['inventory'] },
  { title: 'Red', ids: ['noc', 'gis', 'network'] },
  {
    title: 'MikroTik',
    ids: [
      'inventory-routers',
      'mikrotik',
      'router-enrollment',
      'routeros-templates',
      'routeros-resources',
      'routeros-readonly',
      'inventory-sync',
      'provisioning',
    ],
  },
  { title: 'Finanzas', ids: ['finance'] },
  { title: 'Sistema', ids: ['owner', 'automation', 'notifications', 'user-manual'] },
];

// Módulos que existen y son accesibles, pero NO se listan en el sidebar.
const HIDDEN_TAB_IDS = ['wireguard', 'manual-safe-mode', 'safe-command-queue'];

const VISIBLE_TAB_IDS = EXPECTED_SECTIONS.flatMap((s) => s.ids);
const ALL_TAB_IDS = [...VISIBLE_TAB_IDS, ...HIDDEN_TAB_IDS];

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

describe('Sidebar — secciones reorganizadas (WISP)', () => {
  it('define las 8 secciones WISP OS en orden', () => {
    let cursor = -1;
    for (const { title } of EXPECTED_SECTIONS) {
      const idx = sidebarSource.indexOf(`title: '${title}'`);
      expect(idx, `falta la sección "${title}"`).toBeGreaterThan(-1);
      expect(idx, `la sección "${title}" está fuera de orden`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('ya NO usa los títulos de sección de reorganizaciones previas', () => {
    expect(sidebarSource).not.toContain("title: 'Red WISP'");
    expect(sidebarSource).not.toContain("title: 'Operaciones Seguras'");
    expect(sidebarSource).not.toContain("title: 'MikroTik Workspace'");
    expect(sidebarSource).not.toContain("title: 'Administración'");
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

  it('Routers (inventory-routers) vive en el grupo MikroTik', () => {
    expect(sectionBlock('MikroTik')).toContain("id: 'inventory-routers'");
    // y ya NO en Red
    expect(sectionBlock('Red')).not.toContain("id: 'inventory-routers'");
  });

  it('Manual de Usuario (user-manual) vive en Sistema', () => {
    const block = sectionBlock('Sistema');
    expect(block).toContain("id: 'user-manual'");
    expect(block).toContain('Manual de Usuario');
  });
});

describe('Sidebar — módulos internos ocultos pero conservados', () => {
  it('NO renderiza wireguard / manual-safe-mode / safe-command-queue como items', () => {
    for (const id of HIDDEN_TAB_IDS) {
      expect(sidebarSource, `${id} no debería aparecer como item del sidebar`).not.toContain(
        `id: '${id}'`,
      );
    }
  });

  it('usa el filtro centralizado isVisibleInSidebar', () => {
    expect(sidebarSource).toContain('isVisibleInSidebar');
  });

  it('los módulos ocultos siguen declarados/accesibles en el RBAC (AppTab + roleTabs)', () => {
    for (const id of HIDDEN_TAB_IDS) {
      expect(rbacSource, `${id} debería seguir en el union AppTab`).toContain(`'${id}'`);
    }
    // rbac.ts define el set de ocultos y el helper de visibilidad.
    expect(rbacSource).toContain('SIDEBAR_HIDDEN_TABS');
    expect(rbacSource).toContain('export function isVisibleInSidebar');
  });
});

describe('Sidebar — no se elimina ningún módulo', () => {
  it('los módulos visibles están presentes en el sidebar', () => {
    expect(VISIBLE_TAB_IDS.length).toBe(27);
    for (const id of VISIBLE_TAB_IDS) {
      expect(sidebarSource, `falta el módulo visible ${id}`).toContain(`id: '${id}'`);
    }
  });

  it('cubre los tabs declarados en el RBAC (AppTab)', () => {
    expect(ALL_TAB_IDS.length).toBeGreaterThanOrEqual(29);
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

describe('App — Manual de Usuario integrado', () => {
  it('importa y renderiza UserManualModule cuando el tab está activo', () => {
    expect(appSource).toContain(
      "const UserManualModule = lazy(() => import('./modules/user-manual/UserManualModule'))",
    );
    expect(appSource).toContain("activeTab === 'user-manual'");
    expect(appSource).toContain('<UserManualModule');
  });
});
