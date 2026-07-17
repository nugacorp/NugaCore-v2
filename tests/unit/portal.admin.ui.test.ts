import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Portal admin UI', () => {
  const admin = readFileSync('src/components/PortalAdminModule.tsx', 'utf8');
  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
  const portal = readFileSync('src/components/PortalModule.tsx', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');

  it('PortalAdminModule expone checkboxes por función', () => {
    expect(admin).toContain('portal-feature-');
    expect(admin).toContain('PORTAL_FEATURE_ORDER');
    expect(admin).toContain('portal-admin-save');
    expect(admin).toContain('/api/portal/config');
  });

  it('Sidebar tiene sección Apps desplegable', () => {
    expect(sidebar).toContain("title: 'Apps'");
    expect(sidebar).toContain("id: 'portal-admin'");
    expect(sidebar).toContain("id: 'portal'");
    expect(sidebar).toContain("id: 'tech-pwa'");
    const clientesBlock = sidebar.slice(sidebar.indexOf("title: 'Clientes'"), sidebar.indexOf("title: 'Apps'"));
    expect(clientesBlock).not.toContain("id: 'portal'");
    expect(clientesBlock).not.toContain("id: 'tech-pwa'");
  });

  it('PortalModule respeta features del summary', () => {
    expect(portal).toContain('features.reportFailure');
    expect(portal).toContain('features.invoices');
    expect(portal).toContain('DEFAULT_PORTAL_FEATURES');
  });

  it('App renderiza PortalAdminModule', () => {
    expect(app).toContain('PortalAdminModule');
    expect(app).toContain("activeTab === 'portal-admin'");
  });
});
