import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Consola del propietario — sin simulador ni workflows IA', () => {
  const source = readFileSync('src/components/FinanceOwnerModule.tsx', 'utf8');

  it('elimina simulador app cliente y workflows', () => {
    expect(source).not.toContain('Simulador App Cliente');
    expect(source).not.toContain('btn-owner-portal');
    expect(source).not.toContain('Previsualizador de Portal');
    expect(source).not.toContain('Workflows de IA');
    expect(source).not.toContain('btn-owner-automations');
    expect(source).not.toContain('activeSubTab === \'portal\'');
    expect(source).not.toContain('activeSubTab === \'automations\'');
  });

  it('conserva seguridad para el operador WISP', () => {
    expect(source).toContain('btn-owner-security');
    expect(source).toContain('Consola del Propietario');
    expect(source).toContain('Seguridad (MFA & API Logs)');
  });

  it('no contiene emails de auditoría hardcoded (fake audit logs)', () => {
    expect(source).not.toContain('rnrgool@gmail.com');
    expect(source).not.toContain('miriam.valdez@nuga.com');
    expect(source).not.toContain('carlos.ortiz@nuga.com');
    expect(source).not.toContain('audit-1');
  });

  it('no muestra Stripe Gateway como "Conectado (Live)" — sin datos mock', () => {
    expect(source).not.toContain('Conectado (Live)');
    expect(source).toContain('ExternalIntegrationsPanel');
  });

  it('MFA toggle etiqueta preferencia local pendiente de backend', () => {
    expect(source).toContain('pendiente de backend');
  });
});
