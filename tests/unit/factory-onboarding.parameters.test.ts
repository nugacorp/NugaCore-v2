import { describe, it, expect } from 'vitest';
import { getParameterSchema } from '../../backend/domains/router-template-parameters/registry';
import { mapParametersToLibraryParams } from '../../backend/domains/router-template-parameters/mappers';
import {
  stripWireguardParameterOverrides,
  validateTemplateParameters,
} from '../../backend/domains/router-template-parameters/validators';
import { generateFromTemplate } from '../../backend/domains/routeros-templates/generator';

describe('nugacore_factory_onboarding parameters', () => {
  const schema = getParameterSchema('nugacore_factory_onboarding')!;

  it('tiene esquema WISP sin campos WireGuard', () => {
    expect(schema).toBeTruthy();
    const ids = schema.groups.flatMap((g) => g.parameters.map((p) => p.id));
    expect(ids).toContain('wanInterface');
    expect(ids).toContain('lanCidr');
    expect(ids).toContain('zoneName');
    expect(ids.some((id) => id.startsWith('wg'))).toBe(false);
  });

  it('mapea parámetros WISP al generador', () => {
    const mapped = mapParametersToLibraryParams('nugacore_factory_onboarding', {
      wanInterface: 'ether1',
      lanBridgeName: 'bridge-wisp',
      lanCidr: '10.50.0.1/24',
      lanInterfaces: 'ether2,ether3',
      dhcpEnabled: false,
      zoneName: 'Torre Norte',
      apiPort: 8729,
    });
    expect(mapped.wanInterface).toBe('ether1');
    expect(mapped.lanBridgeName).toBe('bridge-wisp');
    expect(mapped.lanCidr).toBe('10.50.0.0/24');
    expect(mapped.enableDhcp).toBe(false);
    expect(mapped.zoneName).toBe('Torre Norte');
    expect(mapped.apiPort).toBe(8729);
  });

  it('rechaza overrides WireGuard en parámetros', () => {
    const r = validateTemplateParameters('nugacore_factory_onboarding', {
      lanCidr: '192.168.1.1/24',
      wgEndpoint: 'evil:13231',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/WireGuard/i);
  });

  it('stripWireguardParameterOverrides elimina claves wg*', () => {
    const out = stripWireguardParameterOverrides({
      lanCidr: '192.168.1.1/24',
      wgPrivateKey: 'secret',
    });
    expect(out.lanCidr).toBe('192.168.1.1/24');
    expect(out.wgPrivateKey).toBeUndefined();
  });

  it('respeta dhcpEnabled=false en el script', () => {
    const { script } = generateFromTemplate({
      templateId: 'nugacore_factory_onboarding',
      routerName: 'WISP-01',
      routerosVersion: '7',
      enableDhcp: false,
      wgServerPublicKey: 'KEY==',
      wgEndpoint: 'vpn.test:13231',
      wgRouterIp: '10.70.0.2/32',
      wgManagementCidr: '10.70.0.0/16',
      snmpCommunity: 'nc-test',
    });
    expect(script).toContain('DHCP: deshabilitado');
    expect(script).not.toContain('NugaCore-dhcp-LAN');
  });
});
