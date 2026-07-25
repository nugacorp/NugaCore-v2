import { describe, it, expect } from 'vitest';
import { generateFromTemplate } from '../../backend/domains/routeros-templates/generator';
import {
  assertNoBrandViolation,
  assertNoForbiddenPolicies,
  assertNoForbiddenKeywords,
} from '../../backend/domains/routeros-templates/validators';

const WG_PARAMS = {
  templateId: 'nugacore_factory_onboarding' as const,
  routerName: 'CHR-LAB-01',
  routerosVersion: '7' as const,
  wgServerPublicKey: 'FAKE_PUB_KEY_BASE64==',
  wgEndpoint: 'vpn.test.com:13231',
  wgRouterIp: '10.70.0.5/32',
  wgManagementCidr: '10.70.0.0/16',
  wgVpnCidr: '10.70.0.0/16',
  wgPresharedKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  snmpCommunity: 'nc-testcommunity',
  snmpMgmtCidr: '10.70.0.0/16',
  zoneName: 'Lab CHR',
};

describe('Factory onboarding generator', () => {
  it('genera script con WireGuard, API y SNMP', () => {
    const result = generateFromTemplate(WG_PARAMS);
    expect(result.script).toContain('NugaCoreWG');
    expect(result.script).toContain('nugacore_');
    expect(result.script).toContain('/snmp set enabled=yes');
    expect(result.script).toContain('nc-testcommunity');
    expect(result.script).toContain('NugaCore SNMP VPN');
    expect(result.snmpCommunity).toBe('nc-testcommunity');
  });

  it('configura en RouterOS la misma PSK requerida por el peer del servidor', () => {
    const { script } = generateFromTemplate(WG_PARAMS);

    expect(script).toContain(
      'preshared-key="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="',
    );
  });

  it('no incluye comandos prohibidos ni políticas peligrosas', () => {
    const { script } = generateFromTemplate(WG_PARAMS);
    expect(script).not.toContain('system reset-configuration');
    expect(script).not.toContain('sniff');
    assertNoBrandViolation(script);
    assertNoForbiddenPolicies(script);
    assertNoForbiddenKeywords(script);
  });

  it('limita API y SNMP al CIDR VPN', () => {
    const { script } = generateFromTemplate(WG_PARAMS);
    expect(script).toContain('10.70.0.0/16');
    expect(script).toContain('NugaCore API deny external');
    expect(script).toContain('NugaCore SNMP deny external');
  });
});
