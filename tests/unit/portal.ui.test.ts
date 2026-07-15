import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Portal del Cliente UI', () => {
  const portal = readFileSync('src/components/PortalModule.tsx', 'utf8');
  const crm = readFileSync('src/components/CrmModule.tsx', 'utf8');

  it('incluye acceso rápido para copiar el enlace compartible', () => {
    expect(portal).toContain('id="copy-portal-link"');
    expect(portal).toContain('Copiar enlace');
    expect(portal).toContain('buildPortalShareUrl');
    expect(portal).toContain('readPortalClientIdFromSearch');
  });

  it('CRM también puede copiar el enlace del portal', () => {
    expect(crm).toContain('id="crm-copy-portal-link"');
    expect(crm).toContain('Copiar enlace del portal');
  });
});
