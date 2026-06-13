import { describe, it, expect } from 'vitest';
import {
  TemplateParameterSchema,
  buildDefaultParameterValues,
  getParamValue,
  setParamValue,
  groupValuesOf,
  isParameterVisible,
  countConfiguredParameters,
} from '../../src/lib/templateParametersView';

// ── Esquema de prueba (espejo de pcc_2wan reducido) ────────────────────

const SCHEMA: TemplateParameterSchema = {
  templateId: 'pcc_2wan',
  templateName: 'Balanceador PCC — 2 WAN',
  groups: [
    {
      id: 'global',
      label: 'General',
      nested: false,
      parameters: [
        { id: 'pbrEnabled', label: 'PBR', type: 'boolean', required: false, defaultValue: true },
        { id: 'lanCidr', label: 'LAN', type: 'cidr', required: false, defaultValue: '192.168.88.1/24' },
        { id: 'dnsServers', label: 'DNS', type: 'string', required: false, defaultValue: '8.8.8.8' },
      ],
    },
    {
      id: 'wan1',
      label: 'WAN 1',
      nested: true,
      parameters: [
        { id: 'mode', label: 'Modo', type: 'select', required: true, defaultValue: 'dhcp', options: [
          { label: 'DHCP', value: 'dhcp' }, { label: 'Estática', value: 'static' }, { label: 'PPPoE', value: 'pppoe' },
        ] },
        { id: 'interface', label: 'Interfaz', type: 'string', required: true, defaultValue: 'ether1' },
        { id: 'gateway', label: 'Gateway', type: 'ip', required: false },
        { id: 'username', label: 'Usuario', type: 'string', required: false },
        { id: 'password', label: 'Pass', type: 'string', required: false, secret: true },
      ],
    },
  ],
};

const globalGroup = SCHEMA.groups[0];
const wan1Group = SCHEMA.groups[1];

// ── buildDefaultParameterValues ────────────────────────────────────────

describe('buildDefaultParameterValues', () => {
  const v = buildDefaultParameterValues(SCHEMA);

  it('aplica defaults globales al nivel superior', () => {
    expect(v.pbrEnabled).toBe(true);
    expect(v.lanCidr).toBe('192.168.88.1/24');
    expect(v.dnsServers).toBe('8.8.8.8');
  });

  it('aplica defaults de WAN bajo wan1', () => {
    expect((v.wan1 as Record<string, unknown>).mode).toBe('dhcp');
    expect((v.wan1 as Record<string, unknown>).interface).toBe('ether1');
  });

  it('no crea claves para params sin default (gateway)', () => {
    expect((v.wan1 as Record<string, unknown>).gateway).toBeUndefined();
  });
});

// ── get / set inmutable ────────────────────────────────────────────────

describe('getParamValue / setParamValue', () => {
  it('lee valor global', () => {
    const v = buildDefaultParameterValues(SCHEMA);
    expect(getParamValue(v, globalGroup, 'lanCidr')).toBe('192.168.88.1/24');
  });

  it('lee valor anidado WAN', () => {
    const v = buildDefaultParameterValues(SCHEMA);
    expect(getParamValue(v, wan1Group, 'interface')).toBe('ether1');
  });

  it('set global inmutable', () => {
    const v0 = buildDefaultParameterValues(SCHEMA);
    const v1 = setParamValue(v0, globalGroup, 'lanCidr', '10.0.0.1/24');
    expect(getParamValue(v1, globalGroup, 'lanCidr')).toBe('10.0.0.1/24');
    expect(getParamValue(v0, globalGroup, 'lanCidr')).toBe('192.168.88.1/24'); // original intacto
  });

  it('set anidado inmutable y preserva hermanos', () => {
    const v0 = buildDefaultParameterValues(SCHEMA);
    const v1 = setParamValue(v0, wan1Group, 'mode', 'pppoe');
    expect(getParamValue(v1, wan1Group, 'mode')).toBe('pppoe');
    expect(getParamValue(v1, wan1Group, 'interface')).toBe('ether1'); // hermano preservado
    expect(getParamValue(v0, wan1Group, 'mode')).toBe('dhcp'); // original intacto
  });

  it('set anidado sobre grupo inexistente lo crea', () => {
    const v1 = setParamValue({}, wan1Group, 'interface', 'ether9');
    expect(getParamValue(v1, wan1Group, 'interface')).toBe('ether9');
  });
});

// ── groupValuesOf ──────────────────────────────────────────────────────

describe('groupValuesOf', () => {
  it('global devuelve el objeto raíz', () => {
    const v = { lanCidr: 'x', wan1: { mode: 'dhcp' } };
    expect(groupValuesOf(v, globalGroup).lanCidr).toBe('x');
  });
  it('nested devuelve el sub-objeto', () => {
    const v = { wan1: { mode: 'static' } };
    expect(groupValuesOf(v, wan1Group).mode).toBe('static');
  });
  it('nested sin datos → {}', () => {
    expect(groupValuesOf({}, wan1Group)).toEqual({});
  });
});

// ── isParameterVisible ─────────────────────────────────────────────────

describe('isParameterVisible', () => {
  const gateway = wan1Group.parameters.find((p) => p.id === 'gateway')!;
  const username = wan1Group.parameters.find((p) => p.id === 'username')!;
  const password = wan1Group.parameters.find((p) => p.id === 'password')!;
  const iface = wan1Group.parameters.find((p) => p.id === 'interface')!;

  it('gateway visible solo en modo static', () => {
    expect(isParameterVisible(wan1Group, gateway, { mode: 'static' })).toBe(true);
    expect(isParameterVisible(wan1Group, gateway, { mode: 'dhcp' })).toBe(false);
    expect(isParameterVisible(wan1Group, gateway, { mode: 'pppoe' })).toBe(false);
  });

  it('username/password visibles solo en modo pppoe', () => {
    expect(isParameterVisible(wan1Group, username, { mode: 'pppoe' })).toBe(true);
    expect(isParameterVisible(wan1Group, password, { mode: 'pppoe' })).toBe(true);
    expect(isParameterVisible(wan1Group, username, { mode: 'dhcp' })).toBe(false);
    expect(isParameterVisible(wan1Group, password, { mode: 'static' })).toBe(false);
  });

  it('interface siempre visible', () => {
    expect(isParameterVisible(wan1Group, iface, { mode: 'dhcp' })).toBe(true);
    expect(isParameterVisible(wan1Group, iface, { mode: 'static' })).toBe(true);
  });

  it('params globales siempre visibles', () => {
    const lan = globalGroup.parameters.find((p) => p.id === 'lanCidr')!;
    expect(isParameterVisible(globalGroup, lan, {})).toBe(true);
  });

  it('mode por defecto dhcp cuando no está definido', () => {
    expect(isParameterVisible(wan1Group, gateway, {})).toBe(false);
  });
});

// ── countConfiguredParameters ──────────────────────────────────────────

describe('countConfiguredParameters', () => {
  it('cuenta los params con valor presente', () => {
    const v = buildDefaultParameterValues(SCHEMA);
    // global: pbrEnabled(true), lanCidr, dnsServers = 3; wan1: mode, interface = 2 → 5
    expect(countConfiguredParameters(SCHEMA, v)).toBe(5);
  });

  it('no cuenta valores vacíos', () => {
    const v = { lanCidr: '', wan1: { mode: 'dhcp', interface: '' } };
    expect(countConfiguredParameters(SCHEMA, v)).toBe(1); // solo mode
  });

  it('boolean false cuenta como presente', () => {
    const v = { pbrEnabled: false };
    expect(countConfiguredParameters(SCHEMA, v)).toBe(1);
  });
});
