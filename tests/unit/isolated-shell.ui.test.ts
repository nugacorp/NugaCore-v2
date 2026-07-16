import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('IsolatedAppShell — aislamiento portal/tech', () => {
  const shell = readFileSync('src/components/IsolatedAppShell.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  it('IsolatedAppShell existe y no importa Sidebar', () => {
    expect(shell).toContain('isolated-app-shell');
    // Must not import or render Sidebar component
    expect(shell).not.toContain("import Sidebar");
    expect(shell).not.toContain('<Sidebar');
    expect(shell).toContain('UserMenu');
  });

  it('IsolatedAppShell acepta las props requeridas', () => {
    expect(shell).toContain('title');
    expect(shell).toContain('subtitle');
    expect(shell).toContain('children');
    expect(shell).toContain('profile');
    expect(shell).toContain('onLogout');
  });

  it('App.tsx importa IsolatedAppShell', () => {
    expect(app).toContain('IsolatedAppShell');
    expect(app).toContain('isIsolatedScope');
    expect(app).toContain('forcedTabForScope');
  });

  it('App.tsx renderiza IsolatedAppShell antes del bloque del Sidebar', () => {
    // The isolated render block must appear before the admin sidebar
    const isolatedIdx = app.indexOf('<IsolatedAppShell');
    const sidebarIdx = app.indexOf('<Sidebar');
    expect(isolatedIdx).toBeGreaterThan(-1);
    expect(sidebarIdx).toBeGreaterThan(-1);
    expect(isolatedIdx).toBeLessThan(sidebarIdx);
  });

  it('navigateToTab bloquea navegación a otros módulos en scopes aislados', () => {
    expect(app).toContain('forcedTabForScope(getAppScope())');
  });
});
