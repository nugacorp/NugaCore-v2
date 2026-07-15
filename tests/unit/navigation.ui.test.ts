import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ====================================================================
// UX Reorganization WISP LATAM — contrato de navegación del sidebar.
//
// Inspirado en Wispro / WispHub: flujo clientes → facturación → red →
// operaciones; routers MikroTik en Sistema → Routers (un solo lugar).
// Módulos avanzados (lab, sync, provisioning, panel core, scripts) ocultos
// del menú pero accesibles por RBAC/tab directo.
// ====================================================================

const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const rbacSource = readFileSync('src/lib/rbac.ts', 'utf8');

const EXPECTED_SECTIONS: Array<{ title: string; ids: string[] }> = [
  { title: 'Inicio', ids: ['dashboard', 'reports'] },
  { title: 'Clientes', ids: ['crm', 'commercial', 'portal', 'support', 'tech-pwa'] },
  { title: 'Facturación', ids: ['billing', 'payments', 'suspension', 'finance'] },
  { title: 'Red', ids: ['noc', 'gis', 'network'] },
  { title: 'Operaciones', ids: ['inventory'] },
  {
    title: 'Sistema',
    ids: [
      'inventory-routers',
      'routeros-templates',
      'owner',
      'automation',
      'notifications',
      'user-manual',
    ],
  },
];

const HIDDEN_TAB_IDS = [
  'wireguard',
  'router-enrollment',
  'manual-safe-mode',
  'safe-command-queue',
  'mikrotik',
  'routeros-resources',
  'routeros-readonly',
  'inventory-sync',
  'provisioning',
];

const VISIBLE_TAB_IDS = EXPECTED_SECTIONS.flatMap((s) => s.ids);
const ALL_TAB_IDS = [...VISIBLE_TAB_IDS, ...HIDDEN_TAB_IDS];

function sectionBlock(title: string): string {
  const marker = `title: '${title}'`;
  const start = sidebarSource.indexOf(marker);
  if (start === -1) return '';
  const rest = sidebarSource.slice(start + marker.length);
  const next = rest.search(/title: '/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('Sidebar — secciones reorganizadas (WISP LATAM)', () => {
  it('define las 6 secciones WISP en orden', () => {
    let cursor = -1;
    for (const { title } of EXPECTED_SECTIONS) {
      const idx = sidebarSource.indexOf(`title: '${title}'`);
      expect(idx, `falta la sección "${title}"`).toBeGreaterThan(-1);
      expect(idx, `la sección "${title}" está fuera de orden`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('ya NO usa los títulos de reorganizaciones previas', () => {
    expect(sidebarSource).not.toContain("title: 'Control'");
    expect(sidebarSource).not.toContain("title: 'Cobranza'");
    expect(sidebarSource).not.toContain("title: 'Finanzas'");
    expect(sidebarSource).not.toContain("title: 'Red WISP'");
    expect(sidebarSource).not.toContain("title: 'Operaciones Seguras'");
    expect(sidebarSource).not.toContain("title: 'MikroTik Workspace'");
    expect(sidebarSource).not.toContain("title: 'MikroTik'");
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

  it('Sistema prioriza Routers; el alta vive dentro del módulo (no item aparte)', () => {
    const block = sectionBlock('Sistema');
    expect(block).toContain("id: 'inventory-routers'");
    expect(block).toContain("id: 'routeros-templates'");
    expect(block).not.toContain("id: 'router-enrollment'");
    expect(block.indexOf("id: 'inventory-routers'")).toBeLessThan(block.indexOf("id: 'routeros-templates'"));
    expect(block.indexOf("id: 'inventory-routers'")).toBeLessThan(block.indexOf("id: 'owner'"));
    expect(rbacSource).toContain("'router-enrollment'");
    expect(rbacSource).toContain('SIDEBAR_HIDDEN_TABS');
    expect(appSource).toContain('routersOpenEnrollment');
    expect(appSource).toContain("activeTab === 'inventory-routers' || activeTab === 'router-enrollment'");
  });

  it('Finanzas vive en Facturación (no sección aparte)', () => {
    expect(sectionBlock('Facturación')).toContain("id: 'finance'");
    expect(sidebarSource).not.toContain("title: 'Finanzas'");
  });

  it('Manual de Usuario (user-manual) vive en Sistema', () => {
    const block = sectionBlock('Sistema');
    expect(block).toContain("id: 'user-manual'");
    expect(block).toContain('Manual de Usuario');
  });

  it('usa etiquetas en español en Sistema (no inglés)', () => {
    const block = sectionBlock('Sistema');
    expect(block).toContain("name: 'Automatización'");
    expect(block).toContain("name: 'Notificaciones'");
    expect(block).not.toContain('Automation Center');
    expect(block).not.toContain('Notification Center');
  });
});

describe('Sidebar — módulos avanzados ocultos pero conservados', () => {
  it('NO renderiza módulos internos/avanzados como items', () => {
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
    expect(rbacSource).toContain('SIDEBAR_HIDDEN_TABS');
    expect(rbacSource).toContain('export function isVisibleInSidebar');
  });
});

describe('Sidebar — no se elimina ningún módulo', () => {
  it('los módulos visibles están presentes en el sidebar', () => {
    expect(VISIBLE_TAB_IDS.length).toBe(21);
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
    expect(sidebarSource).not.toContain('item.badge');
    expect(sidebarSource).not.toContain('getBadgeClasses');
    expect(sidebarSource).not.toContain('badgeTone');
  });

  it('usa estructura plana por secciones (sin anidamiento parentId)', () => {
    expect(sidebarSource).not.toContain('parentId');
  });

  it('muestra alertas NOC en el item NOC (no en Torres)', () => {
    expect(sidebarSource).toContain('hasNocAlerts');
    expect(sidebarSource).toContain("item.id === 'noc'");
    expect(sidebarSource).not.toContain("item.id === 'network' && activeAlertsCount");
  });

  it('conserva el indicador de tickets abiertos en Soporte', () => {
    expect(sidebarSource).toContain('activeTicketsCount');
    expect(sidebarSource).toContain("item.id === 'support'");
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
      "const UserManualModule = lazyWithRetry(() => import('./modules/user-manual/UserManualModule'))",
    );
    expect(appSource).toContain("activeTab === 'user-manual'");
    expect(appSource).toContain('<UserManualModule');
  });
});
