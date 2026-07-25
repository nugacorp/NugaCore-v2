import { describe, it, expect } from 'vitest';
import {
  ENROLLMENT_SUPPORTED_TEMPLATES,
  validateEnrollmentTemplateId,
  resolveTemplateParams,
  getTemplateMetadata,
} from '../../backend/domains/router-enrollment/template-mapper';
import { TEMPLATE_LIBRARY_VERSION } from '../../backend/domains/routeros-templates/types';
import type { StartEnrollmentInput } from '../../backend/domains/router-enrollment/types';
import type { PeerCreatedOnce } from '../../backend/domains/wireguard/types';

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_INPUT: StartEnrollmentInput = {
  routerName: 'TestRouter',
  routerosVersion: '7',
  lanCidr: '192.168.1.0/24',
  lanGateway: '192.168.1.1',
  wanInterface: 'ether1',
};

const MOCK_PEER: PeerCreatedOnce = {
  peer: { id: 'wgp-1', serverId: 'wgs-1', name: 'TestRouter', publicKey: 'PUBKEY==', allocatedIp: '10.70.0.2/16', allowedCidr: '10.70.0.0/16', status: 'active', applyState: 'applied', hasSecrets: true, createdAt: '' },
  privateKey: 'PRIVKEY==',
  presharedKey: 'PSK==',
  serverPublicKey: 'SERVERPUBKEY==',
  serverEndpoint: '1.2.3.4:51820',
  assignedIp: '10.70.0.2/16',
  allowedCidr: '10.70.0.0/16',
};

// ── ENROLLMENT_SUPPORTED_TEMPLATES ────────────────────────────────────────

describe('ENROLLMENT_SUPPORTED_TEMPLATES', () => {
  it('contiene router_base_wireguard', () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('router_base_wireguard')).toBe(true));
  it('contiene tower_wisp',           () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('tower_wisp')).toBe(true));
  it('contiene pcc_2wan',             () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('pcc_2wan')).toBe(true));
  it('contiene pcc_3wan',             () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('pcc_3wan')).toBe(true));
  it('contiene pcc_4wan',             () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('pcc_4wan')).toBe(true));
  it('contiene pcc_5wan',             () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('pcc_5wan')).toBe(true));
  it('contiene pppoe_server',         () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('pppoe_server')).toBe(true));
  it('contiene noc_ready',            () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('noc_ready')).toBe(true));
  it('contiene monitoring_agent',     () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('monitoring_agent')).toBe(true));
  it('tiene exactamente 10 templates', () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.size).toBe(10));
  it('NO contiene router_base_sstp',  () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('router_base_sstp')).toBe(false));
  it('NO contiene wireguard_client',  () => expect(ENROLLMENT_SUPPORTED_TEMPLATES.has('wireguard_client')).toBe(false));
});

// ── validateEnrollmentTemplateId ──────────────────────────────────────────

describe('validateEnrollmentTemplateId', () => {
  it('no lanza para router_base_wireguard', () => {
    expect(() => validateEnrollmentTemplateId('router_base_wireguard')).not.toThrow();
  });

  it('no lanza para pcc_5wan', () => {
    expect(() => validateEnrollmentTemplateId('pcc_5wan')).not.toThrow();
  });

  it('no lanza para noc_ready', () => {
    expect(() => validateEnrollmentTemplateId('noc_ready')).not.toThrow();
  });

  it('lanza BadRequestError para template desconocido', () => {
    expect(() => validateEnrollmentTemplateId('no_existe')).toThrow();
  });

  it('error tiene code TEMPLATE_NOT_FOUND', () => {
    try {
      validateEnrollmentTemplateId('no_existe');
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe('TEMPLATE_NOT_FOUND');
    }
  });

  it('lanza para undefined', () => {
    expect(() => validateEnrollmentTemplateId(undefined)).toThrow();
  });

  it('lanza para null', () => {
    expect(() => validateEnrollmentTemplateId(null)).toThrow();
  });

  it('lanza para cadena vacía', () => {
    expect(() => validateEnrollmentTemplateId('')).toThrow();
  });

  it('lanza para router_base_sstp (no en wizard)', () => {
    expect(() => validateEnrollmentTemplateId('router_base_sstp')).toThrow();
  });

  it('lanza para wireguard_client (no en wizard)', () => {
    expect(() => validateEnrollmentTemplateId('wireguard_client')).toThrow();
  });
});

// ── resolveTemplateParams — router_base_wireguard ─────────────────────────

describe('resolveTemplateParams — router_base_wireguard', () => {
  const r = resolveTemplateParams('router_base_wireguard', BASE_INPUT, MOCK_PEER);

  it('libraryId es router_base_wireguard', () => {
    expect(r.libraryId).toBe('router_base_wireguard');
  });

  it('needsWireGuard es true', () => {
    expect(r.needsWireGuard).toBe(true);
  });

  it('params.wgPrivateKey viene del peer', () => {
    expect(r.params.wgPrivateKey).toBe('PRIVKEY==');
  });

  it('params.wgPresharedKey viene del mismo peer registrado en el servidor', () => {
    expect(r.params.wgPresharedKey).toBe('PSK==');
  });

  it('params.wgServerPublicKey viene del peer', () => {
    expect(r.params.wgServerPublicKey).toBe('SERVERPUBKEY==');
  });

  it('params.wgEndpoint viene del peer', () => {
    expect(r.params.wgEndpoint).toBe('1.2.3.4:51820');
  });

  it('templateName es string no vacío', () => {
    expect(typeof r.templateName).toBe('string');
    expect(r.templateName.length).toBeGreaterThan(0);
  });

  it('generatorVersion es string no vacío', () => {
    expect(typeof r.generatorVersion).toBe('string');
    expect(r.generatorVersion.length).toBeGreaterThan(0);
  });

  it('params.routerName viene del input', () => {
    expect(r.params.routerName).toBe('TestRouter');
  });

  it('params.routerosVersion viene del input', () => {
    expect(r.params.routerosVersion).toBe('7');
  });

  it('siempre habilita enableLanStack (bridge + LAN por defecto)', () => {
    expect(r.params.enableLanStack).toBe(true);
  });

  it('sin lanInterfaces explícitas usa [] (WISP agrega puertos a mano)', () => {
    const lean = resolveTemplateParams(
      'router_base_wireguard',
      { routerName: 'CHR', routerosVersion: '7' },
      MOCK_PEER,
    );
    expect(lean.params.enableLanStack).toBe(true);
    expect(lean.params.lanInterfaces).toEqual([]);
  });
});

// ── resolveTemplateParams — tower_wisp ───────────────────────────────────

describe('resolveTemplateParams — tower_wisp', () => {
  const r = resolveTemplateParams('tower_wisp', BASE_INPUT, MOCK_PEER);

  it('libraryId es tower_wisp', () => {
    expect(r.libraryId).toBe('tower_wisp');
  });

  it('needsWireGuard es true', () => {
    expect(r.needsWireGuard).toBe(true);
  });

  it('params.wgPrivateKey está presente', () => {
    expect(r.params.wgPrivateKey).toBe('PRIVKEY==');
  });
});

// ── resolveTemplateParams — pcc_2wan ─────────────────────────────────────

describe('resolveTemplateParams — pcc_2wan', () => {
  const r = resolveTemplateParams('pcc_2wan', BASE_INPUT, MOCK_PEER);

  it('libraryId es pcc_2wan', () => {
    expect(r.libraryId).toBe('pcc_2wan');
  });

  it('needsWireGuard es false', () => {
    expect(r.needsWireGuard).toBe(false);
  });

  it('params.wgPrivateKey es undefined', () => {
    expect(r.params.wgPrivateKey).toBeUndefined();
  });

  it('params.wgServerPublicKey es undefined', () => {
    expect(r.params.wgServerPublicKey).toBeUndefined();
  });

  it('pccEnableFailover es true', () => {
    expect(r.params.pccEnableFailover).toBe(true);
  });

  it('pccEnableWatchdog es true', () => {
    expect(r.params.pccEnableWatchdog).toBe(true);
  });

  it('wanInterfaces incluye el wanInterface del input', () => {
    expect(r.params.wanInterfaces).toContain('ether1');
  });
});

// ── resolveTemplateParams — pcc_5wan ─────────────────────────────────────

describe('resolveTemplateParams — pcc_5wan', () => {
  const r = resolveTemplateParams('pcc_5wan', BASE_INPUT, MOCK_PEER);

  it('libraryId es pcc_5wan', () => {
    expect(r.libraryId).toBe('pcc_5wan');
  });

  it('needsWireGuard es false', () => {
    expect(r.needsWireGuard).toBe(false);
  });

  it('params.templateId es pcc_5wan', () => {
    expect(r.params.templateId).toBe('pcc_5wan');
  });
});

// ── resolveTemplateParams — pppoe_server ─────────────────────────────────

describe('resolveTemplateParams — pppoe_server', () => {
  const r = resolveTemplateParams('pppoe_server', BASE_INPUT, MOCK_PEER);

  it('libraryId es pppoe_server', () => {
    expect(r.libraryId).toBe('pppoe_server');
  });

  it('needsWireGuard es false', () => {
    expect(r.needsWireGuard).toBe(false);
  });

  it('params.wgPrivateKey es undefined', () => {
    expect(r.params.wgPrivateKey).toBeUndefined();
  });
});

// ── resolveTemplateParams — noc_ready ────────────────────────────────────

describe('resolveTemplateParams — noc_ready', () => {
  const r = resolveTemplateParams('noc_ready', BASE_INPUT, MOCK_PEER);

  it('libraryId es noc_ready', () => {
    expect(r.libraryId).toBe('noc_ready');
  });

  it('needsWireGuard es false', () => {
    expect(r.needsWireGuard).toBe(false);
  });

  it('generatorVersion está presente', () => {
    expect(r.generatorVersion).toBeTruthy();
  });
});

// ── resolveTemplateParams — monitoring_agent ─────────────────────────────

describe('resolveTemplateParams — monitoring_agent', () => {
  const r = resolveTemplateParams('monitoring_agent', BASE_INPUT, MOCK_PEER);

  it('libraryId es monitoring_agent', () => {
    expect(r.libraryId).toBe('monitoring_agent');
  });

  it('needsWireGuard es false', () => {
    expect(r.needsWireGuard).toBe(false);
  });
});

// ── resolveTemplateParams — template inválido ─────────────────────────────

describe('resolveTemplateParams — template inválido', () => {
  it('lanza BadRequestError para template desconocido', () => {
    expect(() => resolveTemplateParams('no_existe', BASE_INPUT, MOCK_PEER)).toThrow();
  });

  it('error tiene code TEMPLATE_NOT_FOUND', () => {
    try {
      resolveTemplateParams('no_existe', BASE_INPUT, MOCK_PEER);
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe('TEMPLATE_NOT_FOUND');
    }
  });
});

// ── resolveTemplateParams — generatorVersion ─────────────────────────────

describe('resolveTemplateParams — generatorVersion', () => {
  const TEMPLATES = [...ENROLLMENT_SUPPORTED_TEMPLATES];

  it('todos los templates tienen generatorVersion presente', () => {
    for (const tpl of TEMPLATES) {
      const r = resolveTemplateParams(tpl, BASE_INPUT, MOCK_PEER);
      expect(r.generatorVersion, `${tpl} sin generatorVersion`).toBeTruthy();
    }
  });

  it('todos los templates tienen templateName presente', () => {
    for (const tpl of TEMPLATES) {
      const r = resolveTemplateParams(tpl, BASE_INPUT, MOCK_PEER);
      expect(r.templateName, `${tpl} sin templateName`).toBeTruthy();
    }
  });
});

// ── getTemplateMetadata (Blocker 2) ──────────────────────────────────────

describe('getTemplateMetadata', () => {
  it('router_base_wireguard → templateName legible', () => {
    const m = getTemplateMetadata('router_base_wireguard');
    expect(m.templateName).toBeTruthy();
    expect(m.templateName).not.toBe('router_base_wireguard'); // nombre legible, no el id
  });

  it('router_base_wireguard → generatorVersion presente', () => {
    expect(getTemplateMetadata('router_base_wireguard').generatorVersion).toBeTruthy();
  });

  it('pcc_5wan → templateName menciona PCC o 5', () => {
    const m = getTemplateMetadata('pcc_5wan');
    expect(m.templateName).toMatch(/PCC|5/i);
  });

  it('noc_ready → templateName legible', () => {
    expect(getTemplateMetadata('noc_ready').templateName).toBeTruthy();
  });

  it('cada template soportado deriva templateName y generatorVersion', () => {
    for (const tpl of ENROLLMENT_SUPPORTED_TEMPLATES) {
      const m = getTemplateMetadata(tpl);
      expect(m.templateName, `${tpl} sin templateName`).toBeTruthy();
      expect(m.generatorVersion, `${tpl} sin generatorVersion`).toBeTruthy();
    }
  });

  it('templateId desconocido → templateName = el id, generatorVersion = versión por defecto', () => {
    const m = getTemplateMetadata('no_existe');
    expect(m.templateName).toBe('no_existe');
    expect(m.generatorVersion).toBe(TEMPLATE_LIBRARY_VERSION);
  });
});
