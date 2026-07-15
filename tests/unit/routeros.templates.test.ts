// ====================================================================
// Tests unitarios — Biblioteca de Plantillas RouterOS (Fase 4.6.3).
// ====================================================================

import { describe, it, expect } from 'vitest';
import { TEMPLATE_LIBRARY, getTemplateById, getTemplatesByCategory } from '../../backend/domains/routeros-templates/templates';
import { generateFromTemplate } from '../../backend/domains/routeros-templates/generator';
import { validateTemplateParams } from '../../backend/domains/routeros-templates/validators';
import {
  assertNoBrandViolation,
  assertNoForbiddenPolicies,
  assertNoForbiddenKeywords,
  sanitizeForPreview,
  buildTemplateFilename,
} from '../../backend/domains/routeros-templates/validators';
import { TEMPLATE_LIBRARY_IDS, TEMPLATE_LIBRARY_VERSION } from '../../backend/domains/routeros-templates/types';
import { canGenerateTemplate, canViewTemplateHistory, canAccessTemplatesModule } from '../../src/lib/routerosTemplatesRbac';

// ── Parámetros base para generación ────────────────────────────────

const BASE_PARAMS = {
  routerName: 'test-router',
  routerosVersion: '7' as const,
  applyMode: 'existing_config' as const,
};

const WG_PARAMS = {
  ...BASE_PARAMS,
  wgServerPublicKey: 'FAKE_PUB_KEY_BASE64==',
  wgEndpoint: 'vpn.test.com:13231',
  wgRouterIp: '10.10.0.2/24',
  wgManagementCidr: '10.10.0.0/24',
};

const FACTORY_PARAMS = {
  ...WG_PARAMS,
  applyMode: 'factory_reset' as const,
};

// ── Catálogo ────────────────────────────────────────────────────────

describe('Template Library Catalog', () => {
  it('contiene exactamente 14 plantillas', () => {
    expect(TEMPLATE_LIBRARY).toHaveLength(14);
  });

  it('todos los IDs del catálogo son IDs válidos', () => {
    for (const tpl of TEMPLATE_LIBRARY) {
      expect(TEMPLATE_LIBRARY_IDS).toContain(tpl.id);
    }
  });

  it('cada plantilla tiene los campos requeridos', () => {
    for (const tpl of TEMPLATE_LIBRARY) {
      expect(tpl.id).toBeTruthy();
      expect(tpl.name).toBeTruthy();
      expect(tpl.description).toBeTruthy();
      expect(tpl.category).toBeTruthy();
      expect(tpl.routerosVersion).toBeTruthy();
      expect(Array.isArray(tpl.tags)).toBe(true);
      expect(Array.isArray(tpl.features)).toBe(true);
      expect(tpl.generatorVersion).toBe(TEMPLATE_LIBRARY_VERSION);
    }
  });

  it('cubre todas las categorías requeridas', () => {
    const categories = new Set(TEMPLATE_LIBRARY.map((t) => t.category));
    expect(categories).toContain('core');
    expect(categories).toContain('access');
    expect(categories).toContain('tower');
    expect(categories).toContain('balancer');
    expect(categories).toContain('pppoe');
    expect(categories).toContain('monitoring');
    expect(categories).toContain('wireguard');
    expect(categories).toContain('noc');
  });

  it('getTemplateById devuelve la plantilla correcta', () => {
    const tpl = getTemplateById('router_base_wireguard');
    expect(tpl).toBeDefined();
    expect(tpl?.category).toBe('core');
  });

  it('getTemplateById devuelve undefined para ID desconocido', () => {
    expect(getTemplateById('id_inexistente' as any)).toBeUndefined();
  });

  it('getTemplatesByCategory filtra correctamente', () => {
    const balancers = getTemplatesByCategory('balancer');
    expect(balancers).toHaveLength(4); // pcc_2wan, 3, 4, 5
    expect(balancers.every((t) => t.category === 'balancer')).toBe(true);
  });

  it('existen exactamente 4 plantillas PCC balancer', () => {
    const pcc = TEMPLATE_LIBRARY.filter((t) => t.id.startsWith('pcc_'));
    expect(pcc).toHaveLength(4);
  });
});

// ── Generación ─────────────────────────────────────────────────────

describe('Generator — primera línea del script', () => {
  it('todo script generado empieza exactamente con "# NugaCore"', () => {
    const ids = TEMPLATE_LIBRARY_IDS;
    for (const id of ids) {
      let params: any = { templateId: id, ...BASE_PARAMS };
      if (['router_base_wireguard', 'tower_wisp', 'wireguard_client'].includes(id)) params = { ...params, ...WG_PARAMS };
      if (id === 'nugacore_factory_onboarding') params = { ...params, ...FACTORY_PARAMS };
      if (id === 'router_base_sstp') params.sstpHost = 'vpn.test.com';
      if (id === 'wireguard_server') params.wgRouterIp = '10.10.0.1/24';
      if (['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan'].includes(id)) {
        const n = parseInt(id.replace('pcc_', '').replace('wan', ''));
        params.wanInterfaces = Array.from({ length: n }, (_, i) => `ether${i + 1}`);
        params.wanGateways   = Array.from({ length: n }, (_, i) => `10.0.${i}.1`);
      }
      const result = generateFromTemplate(params);
      expect(result.script.split('\n')[0]).toBe('# NugaCore');
    }
  });
});

describe('Generator — Core templates', () => {
  it('genera script router_base_wireguard', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.script).toBeTruthy();
    expect(result.templateId).toBe('router_base_wireguard');
    expect(result.generatorVersion).toBe(TEMPLATE_LIBRARY_VERSION);
    expect(result.scriptHash).toHaveLength(32);
    expect(result.filename).toMatch(/^nc-/);
    expect(result.filename).toMatch(/\.rsc$/);
  });

  it('genera script router_base_sstp', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_sstp',
      ...BASE_PARAMS,
      sstpHost: 'vpn.test.com',
    });
    expect(result.script).toContain('sstp-client');
    expect(result.script).toContain('NugaCore');
  });

  it('script wireguard contiene interfaz NugaCoreWG', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.script).toContain('NugaCoreWG');
  });

  it('WireGuard usa ruta absoluta /interface wireguard add (no bare add)', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      // 44 chars base64 válidos (isWgKey) — private-key va en SET top-level
      wgPrivateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    });
    expect(result.script).toContain('/interface wireguard add name="NugaCoreWG"');
    expect(result.script).not.toMatch(/do=\{\s*\n\s*add name="NugaCoreWG"/);
    // private-key fuera del bloque :if do={...} (paste-safe en Terminal CHR)
    expect(result.script).toContain(
      '/interface wireguard set [find where name="NugaCoreWG"] private-key="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="',
    );
    expect(result.script).not.toMatch(
      /do=\{\s*\n\s*\/interface wireguard add[^\n]*private-key=/,
    );
  });

  it('sin datos WG omite address/peer (nunca placeholders RouterOS-inválidos)', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...BASE_PARAMS });
    expect(result.script).toContain('NugaCoreWG');
    expect(result.script).toContain('INCOMPLETO');
    expect(result.script).not.toContain('<PEGAR_PUBLIC_KEY');
    expect(result.script).not.toContain('<IP_PEER>');
    expect(result.script).not.toContain('<ENDPOINT_HOST>');
    expect(result.script).not.toContain('peers add');
    expect(result.script).not.toMatch(/\/ip address add address=.*interface="NugaCoreWG"/);
    expect(result.warnings.some((w) => /WireGuard incompleto/i.test(w))).toBe(true);
  });

  it('wgRouterIp sin prefijo se normaliza a /32', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      wgRouterIp: '10.70.0.3',
      wgManagementCidr: '10.70.0.0/16',
    });
    expect(result.script).toContain('address="10.70.0.3/32"');
    expect(result.script).toContain('peers add');
  });

  it('CIDR gestión API por defecto es 10.70.0.0/16', () => {
    const result = generateFromTemplate({ templateId: 'noc_ready', ...BASE_PARAMS });
    expect(result.script).toContain('address="10.70.0.0/16"');
  });


  it('corrige typo ehter→ether en WAN y omite ether5 por defecto', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      wanInterface: 'ehter1',
    });
    expect(result.script).toContain('interface="ether1"');
    expect(result.script).not.toContain('ehter1');
    expect(result.script).not.toContain('ether5');
  });

  it('realinea DHCP pool a la subred LAN cuando no coincide', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      lanGateway: '192.168.6.1',
      lanCidr: '192.168.6.0/24',
      dhcpPoolStart: '192.168.1.10',
      dhcpPoolEnd: '192.168.1.254',
    });
    expect(result.script).toContain('ranges="192.168.6.10-192.168.6.254"');
    expect(result.script).toContain('address="192.168.6.1/24"');
    expect(result.script).not.toContain('192.168.1.10-192.168.1.254');
  });

  it('por defecto crea bridge + LAN sin agregar puertos (WISP los añade a mano)', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.script).toContain('nugacore-templates-1.0.7');
    expect(result.script).toContain('/interface bridge add name="bridge-lan"');
    expect(result.script).toContain('address="192.168.1.1/24" interface="bridge-lan"');
    expect(result.script).toContain('NugaCore-pool-LAN');
    expect(result.script).toContain('Puertos: NO se agregan automáticamente');
    expect(result.script).not.toContain('bridge port add interface="ether2"');
    expect(result.script).not.toContain('/interface find where name="ether2"');
    expect(result.warnings.some((w) => /Bridge sin puertos/i.test(w))).toBe(true);
  });

  it('si lanInterfaces se indica, valida existencia antes de añadir al bridge', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      lanInterfaces: ['ether2', 'ether3'],
    });
    expect(result.script).toContain('/interface find where name="ether2"');
    expect(result.script).toContain('/interface bridge port find where interface="ether2"');
    expect(result.script).toContain('bridge port add interface="ether2"');
  });

  it('enableLanStack=false omite bridge/DHCP', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      enableLanStack: false,
      lanInterfaces: [],
    });
    expect(result.script).toContain('LAN/DHCP/NAT/firewall: omitidos');
    expect(result.script).not.toContain('bridge-lan');
    expect(result.script).not.toContain('NugaCore-pool-LAN');
    expect(result.script).toContain('/ip service set [find where name="api" and dynamic=no]');
    expect(result.warnings.some((w) => /LAN omitida/i.test(w))).toBe(true);
  });

  it('API service usa find !dynamic (compatible ROS 7.19+)', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.script).toContain(
      '/ip service set [find where name="api" and dynamic=no] port=8728 address=10.10.0.0/24 disabled=no',
    );
    expect(result.script).toContain(
      '/ip service disable [find where name="telnet" and dynamic=no]',
    );
  });

  it('genera apiUsername para plantillas con usuario API', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.apiUsername).toBeTruthy();
    expect(result.apiUsername).toMatch(/^nugacore_/);
  });

  it('modo existing_config omite identity, DNS global y drop WAN', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      applyMode: 'existing_config',
    });
    expect(result.script).toContain('ApplyMode : existing_config');
    expect(result.script).toContain('MODO: existing_config');
    expect(result.script).toContain('Identidad: omitida');
    expect(result.script).toContain('DNS global: omitido');
    expect(result.script).toContain('drop WAN: omitido');
    expect(result.script).not.toContain('/system identity set');
    expect(result.script).not.toMatch(/\/ip dns set allow-remote-requests/);
    expect(result.script).not.toContain('NugaCore drop WAN');
    expect(result.warnings.some((w) => /existing_config/i.test(w))).toBe(true);
  });

  it('modo factory_reset (wizard) incluye identity, DNS y drop WAN', () => {
    const result = generateFromTemplate({
      templateId: 'router_base_wireguard',
      ...WG_PARAMS,
      applyMode: 'factory_reset',
    });
    expect(result.script).toContain('ApplyMode : factory_reset');
    expect(result.script).toContain('MODO: factory_reset');
    expect(result.script).toContain('/system identity set');
    expect(result.script).toContain('/ip dns set allow-remote-requests');
    expect(result.script).toContain('NugaCore drop WAN');
  });

  it('plantilla factory onboarding fuerza factory_reset', () => {
    const result = generateFromTemplate({
      templateId: 'nugacore_factory_onboarding',
      ...WG_PARAMS,
      // applyMode omitido a propósito
      snmpCommunity: 'nc-test',
    } as any);
    expect(result.script).toContain('ApplyMode : factory_reset');
    expect(result.script).toContain('/system identity set');
  });
});

describe('Generator — Access template', () => {
  it('genera script client_residential', () => {
    const result = generateFromTemplate({ templateId: 'client_residential', ...BASE_PARAMS });
    expect(result.script).toContain('bridge');
    expect(result.script).toContain('NugaCore');
  });

  it('client_residential con WireGuard incluye sección WG', () => {
    const result = generateFromTemplate({ templateId: 'client_residential', ...WG_PARAMS });
    expect(result.script).toContain('NugaCoreWG');
  });
});

describe('Generator — Tower template', () => {
  it('genera script tower_wisp', () => {
    const result = generateFromTemplate({ templateId: 'tower_wisp', ...WG_PARAMS });
    expect(result.script).toContain('NugaCore');
    expect(result.filename).toBe('nc-tower-testrouter.rsc');
  });

  it('tower_wisp con VLANs incluye sección vlan', () => {
    const result = generateFromTemplate({ templateId: 'tower_wisp', ...WG_PARAMS, enableVlans: true });
    expect(result.script).toContain('vlan-mgmt');
    expect(result.script).toContain('vlan-clients');
  });
});

describe('Generator — Balancer templates (PCC)', () => {
  const pccIds = ['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan'] as const;

  for (const id of pccIds) {
    const count = parseInt(id.replace('pcc_', '').replace('wan', ''));
    it(`genera script ${id}`, () => {
      const wanInterfaces = Array.from({ length: count }, (_, i) => `ether${i + 1}`);
      const wanGateways = Array.from({ length: count }, (_, i) => `10.0.${i}.1`);
      const result = generateFromTemplate({
        templateId: id,
        ...BASE_PARAMS,
        wanInterfaces,
        wanGateways,
      });
      expect(result.script).toContain('NugaCore PCC');
      expect(result.script).toContain('per-connection-classifier');
    });
  }

  it('pcc_2wan script contiene mangle PCC:2/0 y PCC:2/1', () => {
    const result = generateFromTemplate({
      templateId: 'pcc_2wan',
      ...BASE_PARAMS,
      wanInterfaces: ['ether1', 'ether2'],
      wanGateways: ['10.0.0.1', '10.0.1.1'],
    });
    expect(result.script).toContain(':2/0');
    expect(result.script).toContain(':2/1');
  });

  it('pcc script con failover incluye netwatch', () => {
    const result = generateFromTemplate({
      templateId: 'pcc_2wan',
      ...BASE_PARAMS,
      wanInterfaces: ['ether1', 'ether2'],
      wanGateways: ['10.0.0.1', '10.0.1.1'],
      pccEnableFailover: true,
    });
    expect(result.script).toContain('netwatch');
  });
});

describe('Generator — PPPoE Server', () => {
  it('genera script pppoe_server', () => {
    const result = generateFromTemplate({ templateId: 'pppoe_server', ...BASE_PARAMS });
    expect(result.script).toContain('pppoe-server');
    expect(result.script).toContain('NugaCore-pppoe-pool');
    expect(result.script).toContain('NugaCore-1M');
  });
});

describe('Generator — Monitoring', () => {
  it('genera script monitoring_agent', () => {
    const result = generateFromTemplate({ templateId: 'monitoring_agent', ...BASE_PARAMS });
    expect(result.script).toContain('NugaCore-AutoBackup');
    expect(result.script).toContain('NugaCore-Metrics');
  });

  it('monitoring sin watchdog no incluye netwatch', () => {
    const result = generateFromTemplate({
      templateId: 'monitoring_agent',
      ...BASE_PARAMS,
      enableWatchdog: false,
    });
    expect(result.script).not.toContain('tool netwatch');
  });
});

describe('Generator — WireGuard templates', () => {
  it('genera script wireguard_client', () => {
    const result = generateFromTemplate({ templateId: 'wireguard_client', ...WG_PARAMS });
    expect(result.script).toContain('NugaCoreWG');
  });

  it('genera script wireguard_server', () => {
    const result = generateFromTemplate({
      templateId: 'wireguard_server',
      ...BASE_PARAMS,
      wgRouterIp: '10.10.0.1/24',
      wgVpnCidr: '10.10.0.0/24',
    });
    expect(result.script).toContain('NugaCoreWG-Server');
    expect(result.script).not.toContain('pppoe'); // no debe tener pppoe
  });

  it('wireguard_server tiene apiUsername', () => {
    const result = generateFromTemplate({
      templateId: 'wireguard_server',
      ...BASE_PARAMS,
      wgRouterIp: '10.10.0.1/24',
    });
    expect(result.apiUsername).toMatch(/^nugacore_/);
  });
});

describe('Generator — NOC Ready', () => {
  it('genera script noc_ready', () => {
    const result = generateFromTemplate({ templateId: 'noc_ready', ...BASE_PARAMS });
    expect(result.script).toContain('nugacore');
    expect(result.script).toContain('NugaCore NOC');
    expect(result.apiUsername).toMatch(/^nugacore_/);
  });

  it('noc_ready sin API-SSL deshabilita api-ssl', () => {
    const result = generateFromTemplate({
      templateId: 'noc_ready',
      ...BASE_PARAMS,
      enableApiSsl: false,
    });
    expect(result.script).toContain(
      '/ip service disable [find where name="api-ssl" and dynamic=no]',
    );
  });
});

// ── Seguridad ──────────────────────────────────────────────────────

describe('Security — branding prohibido', () => {
  const brands = ['livaur', 'wisphub', 'uisp', 'sgcm', 'WHMCS'];

  for (const brand of brands) {
    it(`assertNoBrandViolation lanza si contiene "${brand}"`, () => {
      expect(() => assertNoBrandViolation(`script con ${brand} aquí`)).toThrow();
    });
  }

  it('assertNoBrandViolation no lanza con script limpio NugaCore', () => {
    expect(() => assertNoBrandViolation('# NugaCore script /interface bridge add')).not.toThrow();
  });
});

describe('Security — políticas prohibidas', () => {
  const forbiddenPolicies = ['sniff', 'sensitive', 'romon'];

  for (const policy of forbiddenPolicies) {
    it(`assertNoForbiddenPolicies lanza si policy="${policy}"`, () => {
      expect(() =>
        assertNoForbiddenPolicies(`/user group add policy="read,write,${policy},api"`)
      ).toThrow();
    });
  }

  it('assertNoForbiddenPolicies no lanza con policy mínima NugaCore', () => {
    expect(() =>
      assertNoForbiddenPolicies(`/user group add policy="read,write,api,test"`)
    ).not.toThrow();
  });
});

describe('Security — keywords prohibidos', () => {
  it('assertNoForbiddenKeywords lanza si contiene ftp', () => {
    expect(() => assertNoForbiddenKeywords('/ip service enable ftp')).toThrow();
  });

  it('assertNoForbiddenKeywords lanza si contiene reboot', () => {
    expect(() => assertNoForbiddenKeywords('/system reboot')).toThrow();
  });

  it('assertNoForbiddenKeywords no lanza con script limpio', () => {
    expect(() => assertNoForbiddenKeywords('/ip address add address=192.168.1.1/24')).not.toThrow();
  });
});

describe('Security — sanitización de secretos', () => {
  it('sanitizeForPreview oculta passwords', () => {
    const script = '/user add name="x" password="SuperSecret123"';
    const preview = sanitizeForPreview(script);
    expect(preview).not.toContain('SuperSecret123');
    expect(preview).toContain('••••••••');
  });

  it('sanitizeForPreview oculta private-key', () => {
    const script = '/interface wireguard add private-key="ABCDEF123456=="';
    const preview = sanitizeForPreview(script);
    expect(preview).not.toContain('ABCDEF123456==');
    expect(preview).toContain('<PRIVATE_KEY_OMITIDA>');
  });

  it('sanitizeForPreview no altera el resto del script', () => {
    const script = '/system identity set name="router-01"';
    const preview = sanitizeForPreview(script);
    expect(preview).toBe(script);
  });
});

describe('Security — scripts generados no contienen branding externo', () => {
  const ids = TEMPLATE_LIBRARY_IDS;

  for (const id of ids) {
    it(`${id} no contiene branding prohibido`, () => {
      let params: any = { templateId: id, ...BASE_PARAMS };
      if (['router_base_wireguard', 'tower_wisp', 'wireguard_client'].includes(id)) {
        params = { ...params, ...WG_PARAMS };
      }
      if (id === 'nugacore_factory_onboarding') params = { ...params, ...FACTORY_PARAMS };
      if (id === 'router_base_sstp') params.sstpHost = 'vpn.test.com';
      if (id === 'wireguard_server') params.wgRouterIp = '10.10.0.1/24';
      if (['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan'].includes(id)) {
        const n = parseInt(id.replace('pcc_', '').replace('wan', ''));
        params.wanInterfaces = Array.from({ length: n }, (_, i) => `ether${i + 1}`);
        params.wanGateways = Array.from({ length: n }, (_, i) => `10.0.${i}.1`);
      }
      const result = generateFromTemplate(params);
      const lower = result.script.toLowerCase();
      expect(lower).not.toContain('livaur');
      expect(lower).not.toContain('wisphub');
      expect(lower).not.toContain('uisp');
      expect(lower).not.toContain('sgcm');
    });
  }
});

describe('Security — scripts generados no contienen políticas prohibidas', () => {
  it('ningún script usa sniff/sensitive/romon', () => {
    const result = generateFromTemplate({ templateId: 'noc_ready', ...BASE_PARAMS });
    const policyBlocks = result.script.match(/policy="([^"]+)"/gi) || [];
    for (const block of policyBlocks) {
      expect(block.toLowerCase()).not.toContain('sniff');
      expect(block.toLowerCase()).not.toContain('sensitive');
      expect(block.toLowerCase()).not.toContain('romon');
    }
  });
});

// ── Validadores ────────────────────────────────────────────────────

describe('Validators', () => {
  it('rechaza templateId inválido', () => {
    const result = validateTemplateParams({ templateId: 'fake_template' as any, routerName: 'r1', routerosVersion: '7' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('templateId'))).toBe(true);
  });

  it('rechaza routerName vacío', () => {
    const result = validateTemplateParams({ templateId: 'noc_ready', routerName: '', routerosVersion: '7' });
    expect(result.valid).toBe(false);
  });

  it('rechaza routerosVersion inválida', () => {
    const result = validateTemplateParams({ templateId: 'noc_ready', routerName: 'r1', routerosVersion: '5' as any });
    expect(result.valid).toBe(false);
  });

  it('valida correctamente params mínimos para noc_ready', () => {
    const result = validateTemplateParams({
      templateId: 'noc_ready',
      routerName: 'router-01',
      routerosVersion: '7',
      applyMode: 'existing_config',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('exige applyMode fuera de factory onboarding', () => {
    const result = validateTemplateParams({
      templateId: 'router_base_wireguard',
      routerName: 'r1',
      routerosVersion: '7',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('applyMode'))).toBe(true);
  });

  it('factory onboarding no exige applyMode (siempre factory_reset)', () => {
    const result = validateTemplateParams({
      templateId: 'nugacore_factory_onboarding',
      routerName: 'r1',
      routerosVersion: '7',
    });
    expect(result.valid).toBe(true);
  });

  it('permite router_base_wireguard sin datos WG (generador omite peer, no 400)', () => {
    const result = validateTemplateParams({
      templateId: 'router_base_wireguard',
      routerName: 'r1',
      routerosVersion: '7',
      applyMode: 'existing_config',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('permite router_base_sstp sin host (generador omite cliente SSTP, no 400)', () => {
    const result = validateTemplateParams({
      templateId: 'router_base_sstp',
      routerName: 'r1',
      routerosVersion: '7',
      applyMode: 'existing_config',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requiere wanInterfaces y wanGateways para pcc_3wan', () => {
    const result = validateTemplateParams({
      templateId: 'pcc_3wan',
      routerName: 'r1',
      routerosVersion: '7',
      applyMode: 'existing_config',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('wanInterfaces'))).toBe(true);
  });

  it('rechaza CIDR LAN inválido', () => {
    const result = validateTemplateParams({
      templateId: 'noc_ready',
      routerName: 'r1',
      routerosVersion: '7',
      applyMode: 'existing_config',
      lanCidr: 'not-a-cidr',
    });
    expect(result.valid).toBe(false);
  });

  it('rechaza apiPort fuera de rango', () => {
    const result = validateTemplateParams({
      templateId: 'noc_ready',
      routerName: 'r1',
      routerosVersion: '7',
      applyMode: 'existing_config',
      apiPort: 99999,
    });
    expect(result.valid).toBe(false);
  });
});

// ── Filename ──────────────────────────────────────────────────────

describe('buildTemplateFilename', () => {
  it('genera nombre corto nc-{abbr}-{slug}.rsc', () => {
    const name = buildTemplateFilename('mi-router', 'noc_ready');
    expect(name).toBe('nc-noc-mirouter.rsc');
  });

  it('sanitiza caracteres especiales del routerName', () => {
    const name = buildTemplateFilename('router con espacios!', 'tower_wisp');
    expect(name).toBe('nc-tower-routerconesp.rsc');
    expect(name).not.toContain(' ');
    expect(name).not.toContain('!');
  });

  it('acorta CHR -CHR a nc-wg-chrchr.rsc', () => {
    expect(buildTemplateFilename('CHR -CHR', 'router_base_wireguard')).toBe('nc-wg-chrchr.rsc');
  });
});

// ── RBAC Frontend ──────────────────────────────────────────────────

describe('RBAC Frontend — routerosTemplatesRbac', () => {
  const canGenerate: any[] = ['Super Admin', 'Administrador', 'Técnico'];
  const cannotGenerate: any[] = ['Cobranza', 'Soporte', 'Solo lectura'];
  const canHistory: any[] = ['Super Admin', 'Administrador'];
  const cannotHistory: any[] = ['Técnico', 'Cobranza', 'Soporte', 'Solo lectura'];

  for (const role of canGenerate) {
    it(`canGenerateTemplate: ${role} → true`, () => {
      expect(canGenerateTemplate(role)).toBe(true);
    });
  }

  for (const role of cannotGenerate) {
    it(`canGenerateTemplate: ${role} → false`, () => {
      expect(canGenerateTemplate(role)).toBe(false);
    });
  }

  for (const role of canHistory) {
    it(`canViewTemplateHistory: ${role} → true`, () => {
      expect(canViewTemplateHistory(role)).toBe(true);
    });
  }

  for (const role of cannotHistory) {
    it(`canViewTemplateHistory: ${role} → false`, () => {
      expect(canViewTemplateHistory(role)).toBe(false);
    });
  }

  it('canAccessTemplatesModule: Técnico → true', () => {
    expect(canAccessTemplatesModule('Técnico')).toBe(true);
  });

  it('canAccessTemplatesModule: Cobranza → false', () => {
    expect(canAccessTemplatesModule('Cobranza')).toBe(false);
  });
});
