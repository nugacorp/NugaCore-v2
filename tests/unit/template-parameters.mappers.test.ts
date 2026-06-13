import { describe, it, expect } from 'vitest';
import { mapParametersToLibraryParams } from '../../backend/domains/router-template-parameters/mappers';

// ── Global LAN / DNS ───────────────────────────────────────────────────

describe('mapParametersToLibraryParams — global', () => {
  it('lanCidr (gateway/CIDR) → lanGateway IP + lanCidr red', () => {
    const out = mapParametersToLibraryParams('router_base_wireguard', { lanCidr: '192.168.100.1/24' });
    expect(out.lanGateway).toBe('192.168.100.1');
    expect(out.lanCidr).toBe('192.168.100.0/24');
  });

  it('deriva la red correctamente para /16', () => {
    const out = mapParametersToLibraryParams('router_base_wireguard', { lanCidr: '10.5.20.1/16' });
    expect(out.lanGateway).toBe('10.5.20.1');
    expect(out.lanCidr).toBe('10.5.0.0/16');
  });

  it('dnsServers csv → array', () => {
    const out = mapParametersToLibraryParams('router_base_wireguard', { dnsServers: '8.8.8.8, 1.1.1.1 ,9.9.9.9' });
    expect(out.dnsServers).toEqual(['8.8.8.8', '1.1.1.1', '9.9.9.9']);
  });

  it('sin lanCidr → no setea lanGateway/lanCidr', () => {
    const out = mapParametersToLibraryParams('router_base_wireguard', { dhcpEnabled: true });
    expect(out).not.toHaveProperty('lanCidr');
    expect(out).not.toHaveProperty('lanGateway');
  });

  it('values vacíos → objeto vacío', () => {
    expect(mapParametersToLibraryParams('router_base_wireguard', {})).toEqual({});
    expect(mapParametersToLibraryParams('router_base_wireguard', undefined)).toEqual({});
  });
});

// ── PCC: WAN interfaces / gateways ─────────────────────────────────────

describe('mapParametersToLibraryParams — pcc_5wan', () => {
  const values = {
    pbrEnabled: true,
    lanCidr: '192.168.50.1/24',
    wan1: { mode: 'static', interface: 'ether1', gateway: '200.1.1.1' },
    wan2: { mode: 'static', interface: 'ether2', gateway: '200.2.2.1' },
    wan3: { mode: 'dhcp', interface: 'ether3' },
    wan4: { mode: 'static', interface: 'sfp1', gateway: '200.4.4.1' },
    wan5: { mode: 'dhcp', interface: 'ether5' },
  };

  it('wanInterfaces recoge todas las interfaces presentes en orden', () => {
    const out = mapParametersToLibraryParams('pcc_5wan', values);
    expect(out.wanInterfaces).toEqual(['ether1', 'ether2', 'ether3', 'sfp1', 'ether5']);
  });

  it('wanGateways recoge solo las gateways presentes', () => {
    const out = mapParametersToLibraryParams('pcc_5wan', values);
    expect(out.wanGateways).toEqual(['200.1.1.1', '200.2.2.1', '200.4.4.1']);
  });

  it('lanCidr global también se mapea', () => {
    const out = mapParametersToLibraryParams('pcc_5wan', values);
    expect(out.lanGateway).toBe('192.168.50.1');
    expect(out.lanCidr).toBe('192.168.50.0/24');
  });

  it('pcc_2wan solo recoge 2 WAN', () => {
    const out = mapParametersToLibraryParams('pcc_2wan', {
      wan1: { interface: 'ether1' },
      wan2: { interface: 'ether2' },
      wan3: { interface: 'ether3' }, // ignorado (2wan)
    });
    expect(out.wanInterfaces).toEqual(['ether1', 'ether2']);
  });

  it('sin interfaces no setea wanInterfaces', () => {
    const out = mapParametersToLibraryParams('pcc_2wan', { pbrEnabled: true });
    expect(out).not.toHaveProperty('wanInterfaces');
  });
});

// ── PPPoE ──────────────────────────────────────────────────────────────

describe('mapParametersToLibraryParams — pppoe_server', () => {
  it('mapea pool/interface/localAddress a los campos del generador', () => {
    const out = mapParametersToLibraryParams('pppoe_server', {
      pppoeInterface: 'bridge-lan',
      poolStart: '10.100.0.2',
      poolEnd: '10.100.0.254',
      localAddress: '10.100.0.1',
    });
    expect(out.pppoeInterface).toBe('bridge-lan');
    expect(out.pppoeRemotePoolStart).toBe('10.100.0.2');
    expect(out.pppoeRemotePoolEnd).toBe('10.100.0.254');
    expect(out.pppoeLocalIp).toBe('10.100.0.1');
  });
});

// ── Tower / Monitoring ─────────────────────────────────────────────────

describe('mapParametersToLibraryParams — tower_wisp', () => {
  it('mapea vlanManagement y vlanClients a números', () => {
    const out = mapParametersToLibraryParams('tower_wisp', { vlanManagement: '150', vlanClients: 250 });
    expect(out.vlanManagement).toBe(150);
    expect(out.vlanClients).toBe(250);
  });
});

describe('mapParametersToLibraryParams — monitoring_agent', () => {
  it('mapea watchdogTarget y enableAutoBackup', () => {
    const out = mapParametersToLibraryParams('monitoring_agent', {
      watchdogTarget: '1.1.1.1',
      enableAutoBackup: false,
    });
    expect(out.watchdogTarget).toBe('1.1.1.1');
    expect(out.enableAutoBackup).toBe(false);
  });
});

// ── No clobber con undefined ───────────────────────────────────────────

describe('mapParametersToLibraryParams — no clobber', () => {
  it('solo incluye claves presentes (no undefined)', () => {
    const out = mapParametersToLibraryParams('pcc_2wan', { wan1: { interface: 'ether1' }, wan2: {} });
    // wanGateways no debe existir si no hay gateways
    expect(out).not.toHaveProperty('wanGateways');
    expect(out.wanInterfaces).toEqual(['ether1']);
  });
});
