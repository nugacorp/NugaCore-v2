import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync('src/components/Sidebar.tsx', 'utf8');
const appSource = readFileSync('src/App.tsx', 'utf8');
const userMenuSource = readFileSync('src/components/UserMenu.tsx', 'utf8');

describe('Perfil de usuario — una sola fuente en top bar', () => {
  it('el sidebar no duplica tarjeta de perfil ni logout', () => {
    expect(sidebarSource).not.toContain('Salir del Sistema');
    expect(sidebarSource).not.toContain('onLogout');
    expect(sidebarSource).not.toContain('avatar_url');
    expect(sidebarSource).not.toContain('userProfile.full_name');
  });

  it('App conserva UserMenu interactivo en la barra superior', () => {
    expect(appSource).toContain('UserMenu');
    expect(appSource).toContain('id="desktop-top-bar"');
    expect(appSource).toMatch(/<UserMenu[\s\S]*onLogout=\{handleLogout\}/);
    expect(userMenuSource).toContain('id="user-menu-chip"');
  });
});
