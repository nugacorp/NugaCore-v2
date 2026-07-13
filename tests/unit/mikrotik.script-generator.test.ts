import { describe, it, expect } from 'vitest';
import {
  generateProvisioningScript,
  NUGACORE_GROUP_POLICY,
  FORBIDDEN_POLICIES,
  maskSecret,
} from '../../backend/domains/mikrotik/provisioning/script-generator';
import type { ScriptGenerationInput } from '../../backend/domains/mikrotik/provisioning/types';

// ====================================================================
// Fase 4.4 — generador de script RouterOS (SSTP + WireGuard).
// ====================================================================

const baseInput = (over: Partial<ScriptGenerationInput> = {}): ScriptGenerationInput => ({
  connectionType: 'sstp',
  routerName: 'Router Core Norte',
  apiUser: 'nugacore_abc123',
  apiPassword: 'Str0ngPassw0rd_ExampleValue_1234567890',
  apiPort: 8728,
  vpnUser: 'nugacore_vpn1',
  vpnPassword: 'VpnStr0ng_ExampleValue_0987654321',
  server: {
    vpnHost: 'vpn.nugacore.local',
    vpnCidr: '10.10.0.0/24',
    serverManagementCidr: '10.0.0.0/24',
  },
  ...over,
});

// Política mínima: extrae el contenido de policy="..."
const policyOf = (script: string): string => {
  const m = script.match(/policy="([^"]+)"/);
  return m ? m[1] : '';
};

describe('script SSTP', () => {
  const { script, scriptHash, connectionType } = generateProvisioningScript(baseInput());

  it('es de tipo sstp y trae hash sha256', () => {
    expect(connectionType).toBe('sstp');
    expect(scriptHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('contiene la marca NugaCore y NO contiene wisphub', () => {
    expect(script).toContain('NugaCore');
    expect(script.toLowerCase()).toContain('nugacore');
    expect(script.toLowerCase()).not.toContain('wisphub');
  });

  it('usa permisos mínimos exactos (read,write,api,test)', () => {
    expect(policyOf(script)).toBe(NUGACORE_GROUP_POLICY);
    expect(policyOf(script)).toBe('read,write,api,test');
  });

  it('no incluye permisos prohibidos en la política', () => {
    const policy = policyOf(script);
    for (const forbidden of FORBIDDEN_POLICIES) {
      expect(policy.split(',')).not.toContain(forbidden);
    }
  });

  it('no contiene comandos peligrosos (sniff/romon/sensitive/reboot)', () => {
    const lower = script.toLowerCase();
    for (const bad of ['sniff', 'romon', 'sensitive', 'reboot']) {
      expect(lower).not.toContain(bad);
    }
  });

  it('es idempotente: remueve config NugaCore previa antes de recrear', () => {
    expect(script).toContain('remove [find');
    expect(script).toMatch(/sstp-client remove \[find where name~"NugaCore"\]/);
    expect(script).toContain('/user remove [find where name~"nugacore_"]');
    expect(script).toContain('/system scheduler remove [find where comment~"NugaCore"]');
  });

  it('limita la API a la red VPN de NugaCore', () => {
    expect(script).toContain('/ip service set api');
    expect(script).toContain('address="10.10.0.0/24"');
  });

  it('agrega scheduler de reconexión y ruta de administración', () => {
    expect(script).toContain('NugaCore-VPN-Watchdog');
    expect(script).toContain('/ip route add dst-address="10.0.0.0/24"');
  });

  it('incrusta el usuario API generado', () => {
    expect(script).toContain('name="nugacore_abc123"');
  });

  it('hash determinista para el mismo input', () => {
    const a = generateProvisioningScript(baseInput());
    const b = generateProvisioningScript(baseInput());
    expect(a.scriptHash).toBe(b.scriptHash);
  });
});

describe('script WireGuard', () => {
  it('genera interfaz NugaCoreWG y peer, sin wisphub', () => {
    const { script, connectionType } = generateProvisioningScript(
      baseInput({
        connectionType: 'wireguard',
        server: {
          vpnHost: 'vpn.nugacore.local',
          vpnCidr: '10.10.0.0/24',
          serverManagementCidr: '10.0.0.0/24',
          wgServerPublicKey: 'SERVERPUBKEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=',
          wgEndpoint: 'vpn.nugacore.local:13231',
          wgInterfaceAddress: '10.10.0.5/32',
        },
      }),
    );
    expect(connectionType).toBe('wireguard');
    expect(script).toContain('interface wireguard add name=NugaCoreWG');
    expect(script).toContain('interface wireguard peers add');
    expect(script).toMatch(/interface wireguard peers remove \[find where comment~"NugaCore"\]/);
    expect(script).toMatch(/interface wireguard remove \[find where name~"NugaCore"\]/);
    expect(script).toContain('/system scheduler remove [find where comment~"NugaCore"]');
    expect(script.toLowerCase()).not.toContain('wisphub');
    expect(policyOf(script)).toBe('read,write,api,test');
  });

  it('emite warnings y placeholder cuando falta la public key del servidor', () => {
    const res = generateProvisioningScript(baseInput({ connectionType: 'wireguard' }));
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.script).toContain('<PEGAR_PUBLIC_KEY_DEL_SERVIDOR_NUGACORE>');
  });
});

describe('validación y enmascarado', () => {
  it('lanza si falta un campo requerido', () => {
    expect(() => generateProvisioningScript(baseInput({ apiUser: '' }))).toThrow();
  });
  it('maskSecret nunca expone el valor completo', () => {
    const masked = maskSecret('SuperSecretValue1234');
    expect(masked).not.toBe('SuperSecretValue1234');
    expect(masked).toContain('****');
  });
});
