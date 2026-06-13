import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_PARAMETER_REGISTRY,
  getParameterSchema,
  hasParameterSchema,
  flattenParameters,
} from '../../backend/domains/router-template-parameters/registry';

const PCC = ['pcc_2wan', 'pcc_3wan', 'pcc_4wan', 'pcc_5wan'];
const ALL = Object.keys(TEMPLATE_PARAMETER_REGISTRY);

// ── Estructura general ─────────────────────────────────────────────────

describe('TEMPLATE_PARAMETER_REGISTRY — estructura', () => {
  it('incluye router_base_wireguard', () => expect(hasParameterSchema('router_base_wireguard')).toBe(true));
  it('incluye pcc_2wan', () => expect(hasParameterSchema('pcc_2wan')).toBe(true));
  it('incluye pcc_5wan', () => expect(hasParameterSchema('pcc_5wan')).toBe(true));
  it('incluye pppoe_server', () => expect(hasParameterSchema('pppoe_server')).toBe(true));
  it('incluye noc_ready', () => expect(hasParameterSchema('noc_ready')).toBe(true));
  it('incluye tower_wisp', () => expect(hasParameterSchema('tower_wisp')).toBe(true));
  it('incluye monitoring_agent', () => expect(hasParameterSchema('monitoring_agent')).toBe(true));

  it('cada esquema tiene templateId, templateName y groups', () => {
    for (const id of ALL) {
      const s = TEMPLATE_PARAMETER_REGISTRY[id];
      expect(s.templateId).toBe(id);
      expect(s.templateName).toBeTruthy();
      expect(Array.isArray(s.groups)).toBe(true);
      expect(s.groups.length).toBeGreaterThan(0);
    }
  });

  it('cada parámetro tiene id, label, type y required', () => {
    for (const id of ALL) {
      for (const { parameter: p } of flattenParameters(TEMPLATE_PARAMETER_REGISTRY[id])) {
        expect(p.id, `${id} param sin id`).toBeTruthy();
        expect(p.label, `${id}.${p.id} sin label`).toBeTruthy();
        expect(['string', 'number', 'boolean', 'select', 'ip', 'cidr']).toContain(p.type);
        expect(typeof p.required).toBe('boolean');
      }
    }
  });

  it('los parámetros select tienen options', () => {
    for (const id of ALL) {
      for (const { parameter: p } of flattenParameters(TEMPLATE_PARAMETER_REGISTRY[id])) {
        if (p.type === 'select') {
          expect(p.options, `${id}.${p.id} select sin options`).toBeTruthy();
          expect(p.options!.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// ── getParameterSchema / hasParameterSchema ────────────────────────────

describe('getParameterSchema', () => {
  it('devuelve el esquema para pcc_5wan', () => {
    expect(getParameterSchema('pcc_5wan')?.templateId).toBe('pcc_5wan');
  });
  it('devuelve null para plantilla desconocida', () => {
    expect(getParameterSchema('no_existe')).toBeNull();
  });
  it('hasParameterSchema false para desconocida', () => {
    expect(hasParameterSchema('no_existe')).toBe(false);
  });
});

// ── PCC: grupos global + N WAN ─────────────────────────────────────────

describe('Esquemas PCC', () => {
  it.each([
    ['pcc_2wan', 2],
    ['pcc_3wan', 3],
    ['pcc_4wan', 4],
    ['pcc_5wan', 5],
  ])('%s tiene grupo global + %i grupos WAN', (id, wanCount) => {
    const s = getParameterSchema(id)!;
    const wanGroups = s.groups.filter((g) => /^wan\d+$/.test(g.id));
    expect(wanGroups.length).toBe(wanCount);
    expect(s.groups.some((g) => g.id === 'global')).toBe(true);
  });

  it('cada grupo WAN tiene mode, interface, gateway, bandwidthMbps, pingTarget', () => {
    const s = getParameterSchema('pcc_5wan')!;
    const wan1 = s.groups.find((g) => g.id === 'wan1')!;
    const ids = wan1.parameters.map((p) => p.id);
    expect(ids).toContain('mode');
    expect(ids).toContain('interface');
    expect(ids).toContain('gateway');
    expect(ids).toContain('bandwidthMbps');
    expect(ids).toContain('pingTarget');
  });

  it('el grupo global PCC incluye pbrEnabled, lanCidr, dhcpEnabled, dnsServers', () => {
    const s = getParameterSchema('pcc_2wan')!;
    const g = s.groups.find((g) => g.id === 'global')!;
    const ids = g.parameters.map((p) => p.id);
    expect(ids).toContain('pbrEnabled');
    expect(ids).toContain('lanCidr');
    expect(ids).toContain('dhcpEnabled');
    expect(ids).toContain('dnsServers');
  });

  it('mode es select con opciones dhcp/static/pppoe', () => {
    const wan = getParameterSchema('pcc_3wan')!.groups.find((g) => g.id === 'wan1')!;
    const mode = wan.parameters.find((p) => p.id === 'mode')!;
    expect(mode.type).toBe('select');
    expect(mode.options!.map((o) => o.value)).toEqual(['dhcp', 'static', 'pppoe']);
  });

  it('el password PPPoE de WAN está marcado como secret', () => {
    const wan = getParameterSchema('pcc_2wan')!.groups.find((g) => g.id === 'wan1')!;
    const pass = wan.parameters.find((p) => p.id === 'password')!;
    expect(pass.secret).toBe(true);
  });

  it('los grupos WAN son nested y global no', () => {
    const s = getParameterSchema('pcc_4wan')!;
    expect(s.groups.find((g) => g.id === 'global')!.nested).toBe(false);
    expect(s.groups.find((g) => g.id === 'wan1')!.nested).toBe(true);
  });
});

// ── router_base_wireguard: sin parámetros WireGuard ────────────────────

describe('router_base_wireguard (wireguard_managed)', () => {
  const s = getParameterSchema('router_base_wireguard')!;
  const ids = flattenParameters(s).map((x) => x.parameter.id);

  it('expone lanCidr, dhcpEnabled, dnsServers', () => {
    expect(ids).toContain('lanCidr');
    expect(ids).toContain('dhcpEnabled');
    expect(ids).toContain('dnsServers');
  });

  it('NO expone parámetros de WireGuard (peer/keys/server)', () => {
    expect(ids).not.toContain('wgPeer');
    expect(ids).not.toContain('wgKeys');
    expect(ids).not.toContain('wgServer');
    expect(ids.some((i) => i.toLowerCase().includes('wg'))).toBe(false);
  });
});

// ── pppoe_server ───────────────────────────────────────────────────────

describe('pppoe_server', () => {
  const ids = flattenParameters(getParameterSchema('pppoe_server')!).map((x) => x.parameter.id);
  it('expone pppoeInterface, poolStart, poolEnd, localAddress, dnsServers', () => {
    expect(ids).toContain('pppoeInterface');
    expect(ids).toContain('poolStart');
    expect(ids).toContain('poolEnd');
    expect(ids).toContain('localAddress');
    expect(ids).toContain('dnsServers');
  });
  it('pppoeInterface es requerido', () => {
    const p = flattenParameters(getParameterSchema('pppoe_server')!).find((x) => x.parameter.id === 'pppoeInterface')!;
    expect(p.parameter.required).toBe(true);
  });
});

// ── noc_ready ──────────────────────────────────────────────────────────

describe('noc_ready', () => {
  const ids = flattenParameters(getParameterSchema('noc_ready')!).map((x) => x.parameter.id);
  it('expone telegramEnabled, netwatchEnabled, emailAlerts', () => {
    expect(ids).toContain('telegramEnabled');
    expect(ids).toContain('netwatchEnabled');
    expect(ids).toContain('emailAlerts');
  });
  it('son todos boolean', () => {
    for (const { parameter: p } of flattenParameters(getParameterSchema('noc_ready')!)) {
      expect(p.type).toBe('boolean');
    }
  });
});
