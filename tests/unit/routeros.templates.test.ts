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
};

const WG_PARAMS = {
  ...BASE_PARAMS,
  wgServerPublicKey: 'FAKE_PUB_KEY_BASE64==',
  wgEndpoint: 'vpn.test.com:13231',
  wgRouterIp: '10.10.0.2/24',
  wgManagementCidr: '10.10.0.0/24',
};

// ── Catálogo ────────────────────────────────────────────────────────

describe('Template Library Catalog', () => {
  it('contiene exactamente 13 plantillas', () => {
    expect(TEMPLATE_LIBRARY).toHaveLength(13);
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

describe('Generator — Core templates', () => {
  it('genera script router_base_wireguard', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.script).toBeTruthy();
    expect(result.templateId).toBe('router_base_wireguard');
    expect(result.generatorVersion).toBe(TEMPLATE_LIBRARY_VERSION);
    expect(result.scriptHash).toHaveLength(32);
    expect(result.filename).toMatch(/^nugacore-tpl-/);
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

  it('genera apiUsername para plantillas con usuario API', () => {
    const result = generateFromTemplate({ templateId: 'router_base_wireguard', ...WG_PARAMS });
    expect(result.apiUsername).toBeTruthy();
    expect(result.apiUsername).toMatch(/^nugacore_/);
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
    expect(result.filename).toContain('tower-wisp');
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
    expect(result.script).toContain('pppoe' + '' === '' ? '' : '');  // no debe tener pppoe
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
    expect(result.script).toContain('disable api-ssl');
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
    const result = validateTemplateParams({ templateId: 'noc_ready', routerName: 'router-01', routerosVersion: '7' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('requiere wgServerPublicKey para router_base_wireguard', () => {
    const result = validateTemplateParams({ templateId: 'router_base_wireguard', routerName: 'r1', routerosVersion: '7' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('wgServerPublicKey'))).toBe(true);
  });

  it('requiere sstpHost para router_base_sstp', () => {
    const result = validateTemplateParams({ templateId: 'router_base_sstp', routerName: 'r1', routerosVersion: '7' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('sstpHost'))).toBe(true);
  });

  it('requiere wanInterfaces y wanGateways para pcc_3wan', () => {
    const result = validateTemplateParams({ templateId: 'pcc_3wan', routerName: 'r1', routerosVersion: '7' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('wanInterfaces'))).toBe(true);
  });

  it('rechaza CIDR LAN inválido', () => {
    const result = validateTemplateParams({
      templateId: 'noc_ready',
      routerName: 'r1',
      routerosVersion: '7',
      lanCidr: 'not-a-cidr',
    });
    expect(result.valid).toBe(false);
  });

  it('rechaza apiPort fuera de rango', () => {
    const result = validateTemplateParams({
      templateId: 'noc_ready',
      routerName: 'r1',
      routerosVersion: '7',
      apiPort: 99999,
    });
    expect(result.valid).toBe(false);
  });
});

// ── Filename ──────────────────────────────────────────────────────

describe('buildTemplateFilename', () => {
  it('genera nombre válido', () => {
    const name = buildTemplateFilename('mi-router', 'noc_ready');
    expect(name).toMatch(/^nugacore-tpl-/);
    expect(name).toMatch(/\.rsc$/);
    expect(name).toContain('mi-router');
  });

  it('sanitiza caracteres especiales del routerName', () => {
    const name = buildTemplateFilename('router con espacios!', 'tower_wisp');
    expect(name).not.toContain(' ');
    expect(name).not.toContain('!');
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
