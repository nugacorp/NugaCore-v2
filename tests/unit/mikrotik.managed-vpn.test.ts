import { describe, it, expect } from 'vitest';
import {
  generateProvisioningScript,
  FORBIDDEN_POLICIES,
} from '../../backend/domains/mikrotik/provisioning/script-generator';
import type { ScriptGenerationInput } from '../../backend/domains/mikrotik/provisioning/types';
import { redactScript } from '../../backend/common/secret-redaction';

// ====================================================================
// Fase 4.6.0 — Generadores de provisioning VPN administrada.
// ====================================================================

const base = (over: Partial<ScriptGenerationInput> = {}): ScriptGenerationInput => ({
  connectionType: 'wireguard_managed',
  routerName: 'Router Core',
  apiUser: 'nugacore_abc123',
  apiPassword: 'ApiPlaintextPasswordValue_1234567890ABCDEF',
  apiPort: 8728,
  vpnUser: 'nugacore_vpn1',
  vpnPassword: 'VpnPlaintextPasswordValue_0987654321ZYXWVU',
  server: {
    vpnHost: 'vpn.nugacore.local',
    vpnCidr: '10.10.0.0/24',
    serverManagementCidr: '10.0.0.0/24',
    vpnServerHost: 'vpn.nugacore.local',
    vpnServerPort: 13231,
    vpnNetworkCidr: '10.10.0.0/24',
    routerVpnIp: '10.10.0.5/32',
    allowedApiCidr: '10.10.0.0/24',
    wgServerPublicKey: 'SERVERPUBKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=',
  },
  ...over,
});

const policyOf = (s: string): string => (s.match(/policy="([^"]+)"/)?.[1]) || '';
const noForbidden = (s: string) => {
  const pol = policyOf(s).split(',');
  for (const f of FORBIDDEN_POLICIES) expect(pol).not.toContain(f);
  for (const bad of ['sniff', 'romon', 'sensitive', 'reboot']) expect(s.toLowerCase()).not.toContain(bad);
  expect(s.toLowerCase()).not.toContain('wisphub');
};

describe('wireguard_managed', () => {
  const r = generateProvisioningScript(base());
  it('modo y router VPN IP correctos', () => {
    expect(r.mode).toBe('wireguard_managed');
    expect(r.routerVpnIp).toBe('10.10.0.5/32');
    expect(r.scriptHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('crea NugaCoreWG + peer + allowed-address y limita API a la VPN', () => {
    expect(r.script).toContain('interface wireguard add name=NugaCoreWG');
    expect(r.script).toContain('interface wireguard peers add');
    expect(r.script).toMatch(/interface wireguard remove \[find where name~"NugaCore"\]/);
    expect(r.script).toContain('/system scheduler remove [find where comment~"NugaCore"]');
    expect(r.script).toContain('allowed-address=');
    expect(r.script).toContain('/ip service set [find where name="api" and dynamic=no]');
    expect(r.script).toContain('address=10.10.0.0/24');
  });
  it('permisos operator + sin prohibidos + sin wisphub', () => {
    expect(policyOf(r.script)).toBe('read,write,api,test');
    noForbidden(r.script);
  });
});

describe('sstp_managed', () => {
  const r = generateProvisioningScript(base({ connectionType: 'sstp_managed' }));
  it('crea NugaCoreVPN sstp-client + scheduler + API limitada', () => {
    expect(r.mode).toBe('sstp_managed');
    expect(r.script).toContain('interface sstp-client add name="NugaCoreVPN"');
    expect(r.script).toContain('NugaCore-VPN-Watchdog');
    expect(r.script).toContain('address=10.10.0.0/24');
    noForbidden(r.script);
  });
});

describe('tailscale_lab / direct_lab', () => {
  it('tailscale_lab: sin VPN, API restringida a CIDR de Tailscale, grupo read-only', () => {
    const r = generateProvisioningScript(base({ connectionType: 'tailscale_lab', server: { vpnHost: '', vpnCidr: '', serverManagementCidr: '' } }));
    expect(r.mode).toBe('tailscale_lab');
    expect(r.script).not.toContain('NugaCoreWG');
    expect(r.script).not.toContain('sstp-client add');
    expect(r.script).not.toContain('/ip route add'); // sin rutas
    expect(r.script).toContain('address="100.64.0.0/10"');
    expect(policyOf(r.script)).toBe('read,api,test'); // read-only por defecto
    expect(r.warnings.join(' ')).toMatch(/LABORATORIO/i);
  });
  it('direct_lab: API restringida al allowedApiCidr, sin VPN', () => {
    const r = generateProvisioningScript(base({ connectionType: 'direct_lab', server: { vpnHost: '', vpnCidr: '', serverManagementCidr: '10.20.0.0/24', allowedApiCidr: '10.20.0.0/24' } }));
    expect(r.mode).toBe('direct_lab');
    expect(r.script).toContain('address="10.20.0.0/24"');
    expect(r.script).not.toContain('NugaCoreWG');
  });
  it('apiMode operator fuerza permisos de escritura', () => {
    const r = generateProvisioningScript(base({ connectionType: 'tailscale_lab', apiMode: 'operator' }));
    expect(policyOf(r.script)).toBe('read,write,api,test');
  });
});

describe('compatibilidad legacy', () => {
  it("'wireguard' → wireguard_managed", () => {
    expect(generateProvisioningScript(base({ connectionType: 'wireguard' })).mode).toBe('wireguard_managed');
  });
  it("'sstp' → sstp_managed", () => {
    expect(generateProvisioningScript(base({ connectionType: 'sstp' })).mode).toBe('sstp_managed');
  });
});

describe('seguridad', () => {
  it('el password vive solo dentro del script; redactScript lo oculta', () => {
    const r = generateProvisioningScript(base());
    expect(r.script).toContain('ApiPlaintextPasswordValue_1234567890ABCDEF');
    const safe = redactScript(r.script);
    expect(safe).not.toContain('ApiPlaintextPasswordValue_1234567890ABCDEF');
    expect(safe).toContain('password=****REDACTED****');
  });
  it('scriptHash cambia al rotar el password', () => {
    const a = generateProvisioningScript(base({ apiPassword: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1' }));
    const b = generateProvisioningScript(base({ apiPassword: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2' }));
    expect(a.scriptHash).not.toBe(b.scriptHash);
  });
});
