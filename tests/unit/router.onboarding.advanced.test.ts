import { describe, it, expect } from 'vitest';
import {
  isPccTemplate,
  getWanCountForTemplate,
  buildDefaultWanConfigs,
  buildAdvancedEnrollmentPayload,
  getTemplateLabel,
  DEFAULT_ADVANCED_FORM,
  DEFAULT_WAN_CONFIG,
  DEFAULT_LAN_ADVANCED,
  DEFAULT_SECURITY_CONFIG,
  AdvancedOnboardingForm,
  WanConfig,
} from '../../src/lib/routerOnboardingView';

// ── isPccTemplate ─────────────────────────────────────────────────────

describe('isPccTemplate', () => {
  it('devuelve true para pcc_2wan', () => expect(isPccTemplate('pcc_2wan')).toBe(true));
  it('devuelve true para pcc_3wan', () => expect(isPccTemplate('pcc_3wan')).toBe(true));
  it('devuelve true para pcc_4wan', () => expect(isPccTemplate('pcc_4wan')).toBe(true));
  it('devuelve true para pcc_5wan', () => expect(isPccTemplate('pcc_5wan')).toBe(true));

  it('devuelve false para router_base_wireguard', () => expect(isPccTemplate('router_base_wireguard')).toBe(false));
  it('devuelve false para tower_wisp',           () => expect(isPccTemplate('tower_wisp')).toBe(false));
  it('devuelve false para pppoe_server',          () => expect(isPccTemplate('pppoe_server')).toBe(false));
  it('devuelve false para noc_ready',             () => expect(isPccTemplate('noc_ready')).toBe(false));
  it('devuelve false para template inexistente',  () => expect(isPccTemplate('no_existe')).toBe(false));
});

// ── getWanCountForTemplate ────────────────────────────────────────────

describe('getWanCountForTemplate', () => {
  it('pcc_2wan → 2', () => expect(getWanCountForTemplate('pcc_2wan')).toBe(2));
  it('pcc_3wan → 3', () => expect(getWanCountForTemplate('pcc_3wan')).toBe(3));
  it('pcc_4wan → 4', () => expect(getWanCountForTemplate('pcc_4wan')).toBe(4));
  it('pcc_5wan → 5', () => expect(getWanCountForTemplate('pcc_5wan')).toBe(5));

  it('router_base_wireguard → 0', () => expect(getWanCountForTemplate('router_base_wireguard')).toBe(0));
  it('tower_wisp → 0',            () => expect(getWanCountForTemplate('tower_wisp')).toBe(0));
  it('template desconocido → 0',  () => expect(getWanCountForTemplate('otro')).toBe(0));
});

// ── buildDefaultWanConfigs ────────────────────────────────────────────

describe('buildDefaultWanConfigs', () => {
  it('devuelve 2 WanConfig para count=2', () => {
    expect(buildDefaultWanConfigs(2)).toHaveLength(2);
  });

  it('devuelve 5 WanConfig para count=5', () => {
    expect(buildDefaultWanConfigs(5)).toHaveLength(5);
  });

  it('primer WAN tiene interfaceName ether1, newName WAN1', () => {
    const cfgs = buildDefaultWanConfigs(2);
    expect(cfgs[0].interfaceName).toBe('ether1');
    expect(cfgs[0].newName).toBe('WAN1');
  });

  it('segundo WAN tiene interfaceName ether2, newName WAN2', () => {
    const cfgs = buildDefaultWanConfigs(2);
    expect(cfgs[1].interfaceName).toBe('ether2');
    expect(cfgs[1].newName).toBe('WAN2');
  });

  it('quinto WAN tiene interfaceName ether5, newName WAN5', () => {
    const cfgs = buildDefaultWanConfigs(5);
    expect(cfgs[4].interfaceName).toBe('ether5');
    expect(cfgs[4].newName).toBe('WAN5');
  });

  it('routingTable incremental: wan1, wan2, wan3', () => {
    const cfgs = buildDefaultWanConfigs(3);
    expect(cfgs[0].routingTable).toBe('wan1');
    expect(cfgs[1].routingTable).toBe('wan2');
    expect(cfgs[2].routingTable).toBe('wan3');
  });

  it('routePriority incremental: "1", "2", "3"', () => {
    const cfgs = buildDefaultWanConfigs(3);
    expect(cfgs[0].routePriority).toBe('1');
    expect(cfgs[1].routePriority).toBe('2');
    expect(cfgs[2].routePriority).toBe('3');
  });

  it('todos los WAN tienen connectionType dhcp por defecto', () => {
    for (const w of buildDefaultWanConfigs(5)) {
      expect(w.connectionType).toBe('dhcp');
    }
  });

  it('todos los WAN tienen pingHost 8.8.8.8 por defecto', () => {
    for (const w of buildDefaultWanConfigs(4)) {
      expect(w.pingHost).toBe('8.8.8.8');
    }
  });
});

// ── buildAdvancedEnrollmentPayload — modo básico ───────────────────────

describe('buildAdvancedEnrollmentPayload — modo básico', () => {
  const form: AdvancedOnboardingForm = {
    ...DEFAULT_ADVANCED_FORM,
    routerName: 'TestRouter',
    templateId: 'pcc_2wan',
    configMode: 'basic',
  };

  it('incluye configMode: basic', () => {
    expect(buildAdvancedEnrollmentPayload(form).configMode).toBe('basic');
  });

  it('NO incluye wanConfigs en modo básico', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p).not.toHaveProperty('wanConfigs');
  });

  it('NO incluye lanAdvanced en modo básico', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p).not.toHaveProperty('lanAdvanced');
  });

  it('NO incluye security en modo básico', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p).not.toHaveProperty('security');
  });

  it('incluye routerName y routerosVersion correctos', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p.routerName).toBe('TestRouter');
    expect(p.routerosVersion).toBe('7');
  });

  it('NO incluye wgServerId (usa DEFAULT_WIREGUARD_SERVER)', () => {
    expect(buildAdvancedEnrollmentPayload(form)).not.toHaveProperty('wgServerId');
  });
});

// ── buildAdvancedEnrollmentPayload — pcc_2wan avanzado ────────────────

describe('buildAdvancedEnrollmentPayload — pcc_2wan modo avanzado', () => {
  const wanConfigs: WanConfig[] = buildDefaultWanConfigs(2);
  const form: AdvancedOnboardingForm = {
    ...DEFAULT_ADVANCED_FORM,
    routerName: 'CoreBalancer',
    templateId: 'pcc_2wan',
    configMode: 'advanced',
    wanConfigs,
    lanAdvanced: { ...DEFAULT_LAN_ADVANCED, lanCidr: '10.0.0.0/24', lanGateway: '10.0.0.1' },
    security: { ...DEFAULT_SECURITY_CONFIG, enableHotspotCompatibility: true },
  };

  it('incluye configMode: advanced', () => {
    expect(buildAdvancedEnrollmentPayload(form).configMode).toBe('advanced');
  });

  it('incluye wanConfigs con 2 entradas', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(Array.isArray(p.wanConfigs)).toBe(true);
    expect((p.wanConfigs as WanConfig[]).length).toBe(2);
  });

  it('primera WAN tiene interfaceName ether1', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect((p.wanConfigs as WanConfig[])[0].interfaceName).toBe('ether1');
  });

  it('segunda WAN tiene interfaceName ether2', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect((p.wanConfigs as WanConfig[])[1].interfaceName).toBe('ether2');
  });

  it('lanCidr top-level viene de lanAdvanced en modo avanzado', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p.lanCidr).toBe('10.0.0.0/24');
  });

  it('lanGateway top-level viene de lanAdvanced en modo avanzado', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p.lanGateway).toBe('10.0.0.1');
  });

  it('incluye lanAdvanced completo', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect((p.lanAdvanced as typeof DEFAULT_LAN_ADVANCED).lanCidr).toBe('10.0.0.0/24');
  });

  it('security refleja enableHotspotCompatibility: true', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect((p.security as typeof DEFAULT_SECURITY_CONFIG).enableHotspotCompatibility).toBe(true);
  });

  it('security enableBasicFirewall es true (default)', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect((p.security as typeof DEFAULT_SECURITY_CONFIG).enableBasicFirewall).toBe(true);
  });

  it('NO incluye wgServerId', () => {
    expect(buildAdvancedEnrollmentPayload(form)).not.toHaveProperty('wgServerId');
  });
});

// ── buildAdvancedEnrollmentPayload — pcc_5wan avanzado ────────────────

describe('buildAdvancedEnrollmentPayload — pcc_5wan modo avanzado', () => {
  const wanConfigs: WanConfig[] = buildDefaultWanConfigs(5);

  it('wanConfigs tiene exactamente 5 entradas', () => {
    const form: AdvancedOnboardingForm = {
      ...DEFAULT_ADVANCED_FORM,
      routerName: 'MegaBalancer',
      templateId: 'pcc_5wan',
      configMode: 'advanced',
      wanConfigs,
    };
    const p = buildAdvancedEnrollmentPayload(form);
    expect((p.wanConfigs as WanConfig[]).length).toBe(5);
  });

  it('quinta WAN tiene interfaceName ether5 y routingTable wan5', () => {
    const form: AdvancedOnboardingForm = {
      ...DEFAULT_ADVANCED_FORM,
      routerName: 'MegaBalancer',
      templateId: 'pcc_5wan',
      configMode: 'advanced',
      wanConfigs,
    };
    const p = buildAdvancedEnrollmentPayload(form);
    const wan5 = (p.wanConfigs as WanConfig[])[4];
    expect(wan5.interfaceName).toBe('ether5');
    expect(wan5.routingTable).toBe('wan5');
  });

  it('wanInterface top-level viene de primera WAN en modo avanzado PCC', () => {
    const customWans = buildDefaultWanConfigs(5);
    customWans[0].interfaceName = 'sfp1';
    const form: AdvancedOnboardingForm = {
      ...DEFAULT_ADVANCED_FORM,
      routerName: 'MegaBalancer',
      templateId: 'pcc_5wan',
      configMode: 'advanced',
      wanConfigs: customWans,
    };
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p.wanInterface).toBe('sfp1');
  });
});

// ── buildAdvancedEnrollmentPayload — plantilla no-PCC en avanzado ─────

describe('buildAdvancedEnrollmentPayload — no-PCC en modo avanzado', () => {
  const form: AdvancedOnboardingForm = {
    ...DEFAULT_ADVANCED_FORM,
    routerName: 'TorrePrincipal',
    templateId: 'tower_wisp',
    configMode: 'advanced',
    wanConfigs: [],
  };

  it('NO incluye wanConfigs para plantilla no-PCC', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p).not.toHaveProperty('wanConfigs');
  });

  it('SÍ incluye lanAdvanced y security', () => {
    const p = buildAdvancedEnrollmentPayload(form);
    expect(p).toHaveProperty('lanAdvanced');
    expect(p).toHaveProperty('security');
  });
});

// ── DEFAULT_ADVANCED_FORM ──────────────────────────────────────────────

// ── getTemplateLabel — etiqueta canónica (Blocker 3) ──────────────────

describe('getTemplateLabel', () => {
  it('pcc_5wan → "Balanceador PCC — 5 WAN"', () => {
    expect(getTemplateLabel('pcc_5wan')).toBe('Balanceador PCC — 5 WAN');
  });

  it('router_base_wireguard → "Router Base + WireGuard"', () => {
    expect(getTemplateLabel('router_base_wireguard')).toBe('Router Base + WireGuard');
  });

  it('noc_ready → "NOC Ready"', () => {
    expect(getTemplateLabel('noc_ready')).toBe('NOC Ready');
  });

  it('pppoe_server → "Servidor PPPoE"', () => {
    expect(getTemplateLabel('pppoe_server')).toBe('Servidor PPPoE');
  });

  it('templateId desconocido → devuelve el id como fallback', () => {
    expect(getTemplateLabel('no_existe')).toBe('no_existe');
  });
});

// ── Flujo wizard: selección → resumen → payload (Blocker 3) ────────────
// Simula el setF del wizard (spread inmutable del form con nuevo templateId).

describe('Wizard — selección de plantilla se conserva en resumen y payload', () => {
  const setTemplate = (form: AdvancedOnboardingForm, templateId: string): AdvancedOnboardingForm =>
    ({ ...form, templateId }); // equivalente a setF({ templateId }) del componente

  it('seleccionar pcc_5wan: el label del resumen muestra PCC 5 WAN', () => {
    const form = setTemplate({ ...DEFAULT_ADVANCED_FORM }, 'pcc_5wan');
    expect(getTemplateLabel(form.templateId)).toBe('Balanceador PCC — 5 WAN');
  });

  it('seleccionar pcc_5wan: el payload contiene templateId=pcc_5wan', () => {
    const form = setTemplate({ ...DEFAULT_ADVANCED_FORM, routerName: 'R' }, 'pcc_5wan');
    expect(buildAdvancedEnrollmentPayload(form).templateId).toBe('pcc_5wan');
  });

  it('seleccionar pcc_5wan NO revierte a router_base_wireguard', () => {
    const form = setTemplate({ ...DEFAULT_ADVANCED_FORM, routerName: 'R' }, 'pcc_5wan');
    expect(buildAdvancedEnrollmentPayload(form).templateId).not.toBe('router_base_wireguard');
    expect(getTemplateLabel(form.templateId)).not.toBe('Router Base + WireGuard');
  });

  it('cambiar de pcc_5wan a noc_ready actualiza label y payload', () => {
    let form = setTemplate({ ...DEFAULT_ADVANCED_FORM, routerName: 'R' }, 'pcc_5wan');
    form = setTemplate(form, 'noc_ready');
    expect(getTemplateLabel(form.templateId)).toBe('NOC Ready');
    expect(buildAdvancedEnrollmentPayload(form).templateId).toBe('noc_ready');
  });

  it('sin selección (default): label y payload son router_base_wireguard', () => {
    const form = { ...DEFAULT_ADVANCED_FORM, routerName: 'R' };
    expect(getTemplateLabel(form.templateId)).toBe('Router Base + WireGuard');
    expect(buildAdvancedEnrollmentPayload(form).templateId).toBe('router_base_wireguard');
  });

  it('selección en modo avanzado pcc_5wan también conserva templateId en payload', () => {
    const base = setTemplate({ ...DEFAULT_ADVANCED_FORM, routerName: 'R' }, 'pcc_5wan');
    const form: AdvancedOnboardingForm = {
      ...base,
      configMode: 'advanced',
      wanConfigs: buildDefaultWanConfigs(5),
    };
    const payload = buildAdvancedEnrollmentPayload(form);
    expect(payload.templateId).toBe('pcc_5wan');
    expect(payload.configMode).toBe('advanced');
  });
});

describe('DEFAULT_ADVANCED_FORM', () => {
  it('configMode es basic por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.configMode).toBe('basic');
  });

  it('wanConfigs es array vacío por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.wanConfigs).toEqual([]);
  });

  it('security.enableBasicFirewall es true por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.security.enableBasicFirewall).toBe(true);
  });

  it('security.enableHotspotCompatibility es false por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.security.enableHotspotCompatibility).toBe(false);
  });

  it('security.enablePbr es true por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.security.enablePbr).toBe(true);
  });

  it('lanAdvanced.enableDhcp es true por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.lanAdvanced.enableDhcp).toBe(true);
  });

  it('lanAdvanced.lanCidr es 192.168.88.0/24 por defecto', () => {
    expect(DEFAULT_ADVANCED_FORM.lanAdvanced.lanCidr).toBe('192.168.88.0/24');
  });
});
