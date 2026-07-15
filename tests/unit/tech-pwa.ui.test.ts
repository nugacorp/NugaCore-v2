import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('App Técnicos UI', () => {
  const source = readFileSync('src/modules/tech-pwa/TechPwaModule.tsx', 'utf8');

  it('incluye acceso rápido para copiar el enlace compartible', () => {
    expect(source).toContain('id="copy-tech-app-link"');
    expect(source).toContain('Copiar enlace');
    expect(source).toContain('buildTechAppShareUrl');
  });

  it('muestra empty state cuando no hay órdenes', () => {
    expect(source).toContain('No hay órdenes pendientes');
    expect(source).toContain('Agenda de hoy');
  });
});
