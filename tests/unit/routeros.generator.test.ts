import { describe, it, expect } from 'vitest';
import { generateResource } from '../../backend/domains/routeros-resources/generator';
import { sanitizeScriptForPreview, buildFilename, assertNoBrandViolation, assertNoForbiddenPolicies } from '../../backend/domains/routeros-resources/safe-rsc';
import { validateParams } from '../../backend/domains/routeros-resources/validators';
import { TEMPLATES, getTemplate } from '../../backend/domains/routeros-resources/templates';
import type { ResourceGeneratorParams } from '../../backend/domains/routeros-resources/types';

const BASE_PARAMS: ResourceGeneratorParams = {
  templateId: 'base_wisp_wireguard',
  routerName: 'TEST-ROUTER',
  lanBridgeName: 'bridgeLAN',
  lanCidr: '192.168.88.0/24',
  lanGateway: '192.168.88.1',
  dhcpPoolStart: '192.168.88.10',
  dhcpPoolEnd: '192.168.88.254',
  dnsServers: ['1.1.1.1', '8.8.8.8'],
  wanInterface: 'ether1',
  lanInterfaces: ['ether2', 'ether3'],
  enableNat: true,
  enableBasicFirewall: true,
  enableDhcpServer: true,
  routerosVersion: '7',
  apiMode: 'operator',
  apiPort: 8728,
  wgServerPublicKey: 'testPublicKey==',
  wgEndpoint: 'vpn.nugacore.test:13231',
  wgRouterIp: '10.10.0.5/32',
  wgManagementCidr: '10.10.0.0/24',
  wgVpnCidr: '10.10.0.0/24',
  wgKeepalive: 25,
};

describe('RouterOS Resource Generator — script base_wisp_wireguard', () => {
  it('genera un script no vacío con hash', () => {
    const result = generateResource(BASE_PARAMS);
    expect(result.script.length).toBeGreaterThan(500);
    expect(result.scriptHash).toHaveLength(64);
    expect(result.filename).toMatch(/^nugacore-base-wisp-wireguard-/);
  });

  it('el script contiene configuración LAN', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('bridgeLAN');
    expect(script).toContain('192.168.88.1');
    expect(script).toContain('192.168.88.0/24');
  });

  it('el script contiene DHCP pool y server', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('NugaCore-pool-LAN');
    expect(script).toContain('NugaCore-dhcp-LAN');
    expect(script).toContain('192.168.88.10');
    expect(script).toContain('192.168.88.254');
  });

  it('el script contiene NAT masquerade', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('masquerade');
    expect(script).toContain('NugaCore NAT');
  });

  it('el script contiene el bloque WireGuard', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('NugaCoreWG');
    expect(script).toContain('testPublicKey==');
    expect(script).toContain('vpn.nugacore.test');
    expect(script).toContain('13231');
    expect(script).toContain('10.10.0.5/32');
  });

  it('el script contiene usuario y grupo API nugacore', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('nugacore_');
    expect(script).toContain('group="nugacore"');
    expect(script).toContain('read,write,api,test');
  });

  it('el script limita la API al CIDR VPN', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('10.10.0.0/24');
    expect(script).toContain('ip service set api');
  });

  it('el script contiene watchdog scheduler', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('NugaCore-WG-Watchdog');
  });

  it('el script contiene system note con nombre del router', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).toContain('TEST-ROUTER');
    expect(script).toContain('/system note set');
  });

  it('el apiUsername tiene el formato nugacore_*', () => {
    const result = generateResource(BASE_PARAMS);
    expect(result.apiUsername).toMatch(/^nugacore_/);
  });

  it('no contiene branding externo (Livaur / WispHub)', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script.toLowerCase()).not.toContain('livaur');
    expect(script.toLowerCase()).not.toContain('wisphub');
  });

  it('no contiene políticas prohibidas (sniff, sensitive, romon)', () => {
    const { script } = generateResource(BASE_PARAMS);
    expect(script).not.toMatch(/policy="[^"]*sniff/i);
    expect(script).not.toMatch(/policy="[^"]*sensitive/i);
    expect(script).not.toMatch(/policy="[^"]*romon/i);
    expect(script).not.toMatch(/policy="[^"]*reboot/i);
  });

  it('el script es diferente en cada llamada (credenciales únicas)', () => {
    const r1 = generateResource(BASE_PARAMS);
    const r2 = generateResource(BASE_PARAMS);
    expect(r1.scriptHash).not.toBe(r2.scriptHash);
    expect(r1.apiUsername).not.toBe(r2.apiUsername);
  });
});

describe('RouterOS Resource Generator — plantilla SSTP', () => {
  const SSTP_PARAMS: ResourceGeneratorParams = {
    ...BASE_PARAMS,
    templateId: 'base_wisp_sstp',
    routerosVersion: '6',
    sstpHost: 'sstp.nugacore.test',
    sstpManagementCidr: '10.10.0.0/24',
    sstpVpnCidr: '10.10.0.0/24',
  };

  it('genera script con bloque SSTP', () => {
    const { script } = generateResource(SSTP_PARAMS);
    expect(script).toContain('NugaCoreVPN');
    expect(script).toContain('sstp.nugacore.test');
    expect(script).toContain('NugaCore-VPN-Watchdog');
  });

  it('no contiene bloque WireGuard', () => {
    const { script } = generateResource(SSTP_PARAMS);
    expect(script).not.toContain('NugaCoreWG');
  });
});

describe('RouterOS Resource Generator — plantilla lab_direct', () => {
  const LAB_PARAMS: ResourceGeneratorParams = {
    ...BASE_PARAMS,
    templateId: 'lab_direct',
  };

  it('genera script sin VPN', () => {
    const { script } = generateResource(LAB_PARAMS);
    expect(script).not.toContain('NugaCoreWG');
    expect(script).not.toContain('NugaCoreVPN');
    expect(script).toContain('laboratorio');
  });
});

describe('safe-rsc — sanitizeScriptForPreview', () => {
  it('redacta passwords en la vista previa', () => {
    const script = `/user add name="nugacore_abc" password="SuperSecretPass123" group="nugacore"`;
    const preview = sanitizeScriptForPreview(script);
    expect(preview).not.toContain('SuperSecretPass123');
    expect(preview).toContain('••••••••');
  });

  it('redacta private-key en la vista previa', () => {
    const script = `/interface wireguard peers add public-key="serverKey==" private-key="MYSECRETPRIVKEY=="`;
    const preview = sanitizeScriptForPreview(script);
    expect(preview).not.toContain('MYSECRETPRIVKEY');
    expect(preview).toContain('PRIVATE_KEY_OMITIDA');
  });

  it('no modifica líneas sin secretos', () => {
    const script = `/system identity set name="TEST-ROUTER"`;
    const preview = sanitizeScriptForPreview(script);
    expect(preview).toBe(script);
  });
});

describe('safe-rsc — buildFilename', () => {
  it('genera nombre de archivo con prefijo nugacore y fecha', () => {
    const name = buildFilename('MI-ROUTER', 'base_wisp_wireguard');
    expect(name).toMatch(/^nugacore-base-wisp-wireguard-MI-ROUTER-\d{4}-\d{2}-\d{2}\.rsc$/);
  });

  it('sanitiza caracteres especiales en el nombre', () => {
    const name = buildFilename('Router Test #1!', 'base_wisp_sstp');
    expect(name).not.toContain('#');
    expect(name).not.toContain('!');
    expect(name).not.toContain(' ');
  });
});

describe('safe-rsc — assertNoBrandViolation', () => {
  it('lanza si el script contiene "livaur"', () => {
    expect(() => assertNoBrandViolation('# Script by livaur.com')).toThrow();
  });

  it('lanza si el script contiene "wisphub"', () => {
    expect(() => assertNoBrandViolation('# wisphub config')).toThrow();
  });

  it('no lanza para un script NugaCore limpio', () => {
    expect(() => assertNoBrandViolation('# NugaCore script\n/system identity')).not.toThrow();
  });
});

describe('safe-rsc — assertNoForbiddenPolicies', () => {
  it('lanza si el script contiene policy con sniff', () => {
    expect(() => assertNoForbiddenPolicies('/user group add policy="read,write,sniff"')).toThrow();
  });

  it('no lanza con la política mínima NugaCore', () => {
    expect(() =>
      assertNoForbiddenPolicies('/user group add policy="read,write,api,test"'),
    ).not.toThrow();
  });
});

describe('Validators — validateParams', () => {
  it('valida params completos como válidos', () => {
    const result = validateParams(BASE_PARAMS);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reporta error si falta routerName', () => {
    const { valid, errors } = validateParams({ ...BASE_PARAMS, routerName: '' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('routerName'))).toBe(true);
  });

  it('reporta error si lanCidr es inválido', () => {
    const { valid, errors } = validateParams({ ...BASE_PARAMS, lanCidr: '999.x.y' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('lanCidr'))).toBe(true);
  });

  it('reporta error si faltan campos WireGuard para base_wisp_wireguard', () => {
    const { valid, errors } = validateParams({ ...BASE_PARAMS, wgEndpoint: '', wgRouterIp: '' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('wgEndpoint'))).toBe(true);
    expect(errors.some((e) => e.includes('wgRouterIp'))).toBe(true);
  });

  it('reporta error si falta sstpHost para base_wisp_sstp', () => {
    const { valid, errors } = validateParams({
      ...BASE_PARAMS,
      templateId: 'base_wisp_sstp',
      sstpHost: '',
      sstpManagementCidr: '10.10.0.0/24',
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('sstpHost'))).toBe(true);
  });
});

describe('Templates catalog', () => {
  it('contiene 3 plantillas', () => {
    expect(TEMPLATES).toHaveLength(3);
  });

  it('base_wisp_wireguard existe con categoría production', () => {
    const t = getTemplate('base_wisp_wireguard');
    expect(t).toBeDefined();
    expect(t?.category).toBe('production');
    expect(t?.rosVersionRequired).toBe('7');
  });

  it('lab_direct existe con categoría lab', () => {
    const t = getTemplate('lab_direct');
    expect(t?.category).toBe('lab');
  });
});
