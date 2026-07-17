import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildIntegrationView } from '../../backend/domains/integrations/delivery';
import { emptyIntegrationSettings } from '../../backend/domains/integrations/repository';

describe('ExternalIntegrationsPanel — UI', () => {
  const panel = readFileSync('src/components/owner/ExternalIntegrationsPanel.tsx', 'utf8');
  const owner = readFileSync('src/components/FinanceOwnerModule.tsx', 'utf8');

  it('monta formulario con Stripe, WhatsApp, Telegram y CoDi', () => {
    expect(panel).toContain('external-integrations-panel');
    expect(panel).toContain('/api/integrations/settings');
    expect(panel).toContain('CoDi');
    expect(panel).toContain('integrations-save');
  });

  it('FinanceOwnerModule usa el panel de integraciones', () => {
    expect(owner).toContain('ExternalIntegrationsPanel');
    expect(owner).not.toContain('sin datos mock');
  });
});

describe('integrations delivery view', () => {
  it('marca servicios no configurados sin mock', () => {
    const view = buildIntegrationView(emptyIntegrationSettings());
    expect(view.statuses.stripe.statusLabel).toBe('No conectado');
    expect(view.statuses.codi.statusLabel).toBe('No configurado');
  });
});
