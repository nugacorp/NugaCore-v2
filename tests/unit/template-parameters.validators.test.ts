import { describe, it, expect } from 'vitest';
import {
  validateTemplateParameters,
  redactSecretValues,
  applyDefaults,
  REDACTED,
} from '../../backend/domains/router-template-parameters/validators';

// ── validateTemplateParameters — básico ────────────────────────────────

describe('validateTemplateParameters — router_base_wireguard', () => {
  it('valores válidos pasan', () => {
    const r = validateTemplateParameters('router_base_wireguard', {
      lanCidr: '192.168.10.1/24',
      dhcpEnabled: true,
      dnsServers: '8.8.8.8',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('lanCidr inválido falla', () => {
    const r = validateTemplateParameters('router_base_wireguard', { lanCidr: 'no-es-cidr' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CIDR/i);
  });

  it('dhcpEnabled no booleano falla', () => {
    const r = validateTemplateParameters('router_base_wireguard', { dhcpEnabled: 'sí' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/booleano/i);
  });

  it('valores vacíos/undefined son válidos (sin requeridos)', () => {
    expect(validateTemplateParameters('router_base_wireguard', {}).valid).toBe(true);
    expect(validateTemplateParameters('router_base_wireguard', undefined).valid).toBe(true);
  });
});

// ── validateTemplateParameters — sin esquema ───────────────────────────

describe('validateTemplateParameters — plantilla sin esquema', () => {
  it('values vacíos → válido', () => {
    expect(validateTemplateParameters('no_existe', {}).valid).toBe(true);
  });
  it('values no vacíos → inválido', () => {
    const r = validateTemplateParameters('no_existe', { foo: 'bar' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/no admite par/i);
  });
});

// ── validateTemplateParameters — PCC requeridos y tipos ────────────────

describe('validateTemplateParameters — pcc_2wan', () => {
  const valid = {
    pbrEnabled: true,
    lanCidr: '192.168.100.1/24',
    dhcpEnabled: true,
    dnsServers: '8.8.8.8,1.1.1.1',
    wan1: { mode: 'dhcp', interface: 'ether1' },
    wan2: { mode: 'static', interface: 'ether2', gateway: '200.1.1.1' },
  };

  it('configuración completa válida', () => {
    expect(validateTemplateParameters('pcc_2wan', valid).valid).toBe(true);
  });

  it('mode requerido faltante falla', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan1: { interface: 'ether1' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Modo de conexión.*requerido/i);
  });

  it('interface requerido faltante falla', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan1: { mode: 'dhcp' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Interfaz física.*requerid/i);
  });

  it('modo static sin gateway falla (regla condicional)', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan2: { mode: 'static', interface: 'ether2' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Gateway es requerido en modo est/i);
  });

  it('modo dhcp sin gateway es válido', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan2: { mode: 'dhcp', interface: 'ether2' },
    });
    expect(r.valid).toBe(true);
  });

  it('mode con valor no permitido falla', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan1: { mode: 'satelital', interface: 'ether1' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/no permitido/i);
  });

  it('gateway no-IP falla', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan2: { mode: 'static', interface: 'ether2', gateway: 'xxx' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/IP válida/i);
  });

  it('bandwidthMbps no numérico falla', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan1: { mode: 'dhcp', interface: 'ether1', bandwidthMbps: 'rápido' },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/numérico/i);
  });

  it('pingTarget IP válida pasa', () => {
    const r = validateTemplateParameters('pcc_2wan', {
      ...valid,
      wan1: { mode: 'dhcp', interface: 'ether1', pingTarget: '1.1.1.1' },
    });
    expect(r.valid).toBe(true);
  });
});

// ── validateTemplateParameters — pppoe_server ──────────────────────────

describe('validateTemplateParameters — pppoe_server', () => {
  it('completo válido', () => {
    const r = validateTemplateParameters('pppoe_server', {
      pppoeInterface: 'bridge-lan',
      poolStart: '10.100.0.2',
      poolEnd: '10.100.0.254',
      localAddress: '10.100.0.1',
    });
    expect(r.valid).toBe(true);
  });

  it('pppoeInterface requerido faltante falla', () => {
    const r = validateTemplateParameters('pppoe_server', {
      poolStart: '10.100.0.2',
      poolEnd: '10.100.0.254',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/Interfaz PPPoE.*requerid/i);
  });

  it('poolStart no-IP falla', () => {
    const r = validateTemplateParameters('pppoe_server', {
      pppoeInterface: 'bridge-lan',
      poolStart: 'no-ip',
      poolEnd: '10.100.0.254',
    });
    expect(r.valid).toBe(false);
  });
});

// ── redactSecretValues ─────────────────────────────────────────────────

describe('redactSecretValues', () => {
  it('redacta el password PPPoE de un WAN', () => {
    const out = redactSecretValues('pcc_2wan', {
      wan2: { mode: 'pppoe', interface: 'ether2', username: 'cliente', password: 'secreto' },
    });
    expect((out.wan2 as Record<string, unknown>).password).toBe(REDACTED);
  });

  it('NO redacta campos no secret (username queda)', () => {
    const out = redactSecretValues('pcc_2wan', {
      wan2: { mode: 'pppoe', interface: 'ether2', username: 'cliente', password: 'secreto' },
    });
    expect((out.wan2 as Record<string, unknown>).username).toBe('cliente');
  });

  it('no muta el objeto original', () => {
    const original = { wan1: { mode: 'pppoe', password: 'top-secret' } };
    redactSecretValues('pcc_2wan', original);
    expect(original.wan1.password).toBe('top-secret');
  });

  it('valores sin secretos quedan intactos', () => {
    const out = redactSecretValues('router_base_wireguard', { lanCidr: '192.168.1.1/24' });
    expect(out.lanCidr).toBe('192.168.1.1/24');
  });

  it('values null → {}', () => {
    expect(redactSecretValues('pcc_2wan', null)).toEqual({});
  });

  it('no redacta password vacío (no presente)', () => {
    const out = redactSecretValues('pcc_2wan', { wan1: { mode: 'dhcp', password: '' } });
    expect((out.wan1 as Record<string, unknown>).password).toBe('');
  });
});

// ── applyDefaults ──────────────────────────────────────────────────────

describe('applyDefaults', () => {
  it('rellena defaults globales faltantes', () => {
    const out = applyDefaults('router_base_wireguard', {});
    expect(out.dhcpEnabled).toBe(true);
    expect(out.lanCidr).toBeTruthy();
  });

  it('respeta valores provistos', () => {
    const out = applyDefaults('router_base_wireguard', { lanCidr: '10.0.0.1/24' });
    expect(out.lanCidr).toBe('10.0.0.1/24');
  });

  it('rellena defaults en grupos WAN nested', () => {
    const out = applyDefaults('pcc_2wan', {});
    expect((out.wan1 as Record<string, unknown>).mode).toBe('dhcp');
    expect((out.wan1 as Record<string, unknown>).interface).toBe('ether1');
    expect((out.wan2 as Record<string, unknown>).interface).toBe('ether2');
  });

  it('plantilla sin esquema → devuelve los valores tal cual', () => {
    expect(applyDefaults('no_existe', { a: 1 })).toEqual({ a: 1 });
  });
});
