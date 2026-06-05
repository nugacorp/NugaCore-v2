import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// ====================================================================
// Fase 4.6.0 — La UI muestra el selector de modos con WireGuard recomendado
// y Tailscale/Direct como laboratorio. (Scan de fuente.)
// ====================================================================

const panel = readFileSync('src/components/MikrotikRoutersPanel.tsx', 'utf8');

describe('UI selector de modos VPN', () => {
  it('incluye los 4 modos administrados', () => {
    expect(panel).toContain('wireguard_managed');
    expect(panel).toContain('sstp_managed');
    expect(panel).toContain('tailscale_lab');
    expect(panel).toContain('direct_lab');
  });

  it('WireGuard marcado como recomendado, SSTP fallback, Tailscale/Direct laboratorio', () => {
    expect(panel).toContain('Recomendado');
    expect(panel).toContain('Fallback');
    expect(panel).toContain('Laboratorio');
  });

  it('por defecto selecciona WireGuard administrado', () => {
    expect(panel).toContain("useState<MikrotikProvisioningMode>('wireguard_managed')");
  });
});
