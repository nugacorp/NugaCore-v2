import { describe, expect, it } from 'vitest';
import {
  buildAuthorizeCommands,
  buildReactivateCommands,
  buildSuspendCommands,
  buildWarningCommands,
  NC_ADDR,
  normalizeAccessListName,
} from '../../backend/domains/mikrotik/access-control';
import { generateFromTemplate } from '../../backend/domains/routeros-templates/generator';

describe('MikroTik access-control (nc-* lists)', () => {
  it('normaliza aliases WispHub/legacy a listas canónicas', () => {
    expect(normalizeAccessListName('Moroso')).toBe(NC_ADDR.suspended);
    expect(normalizeAccessListName('Aviso')).toBe(NC_ADDR.warning);
    expect(normalizeAccessListName('NUGACORE_SUSPENDED')).toBe(NC_ADDR.suspended);
    expect(normalizeAccessListName('nugacore-active')).toBe(NC_ADDR.authorized);
  });

  it('suspend mueve a nc-suspended y corta PPP/queue', () => {
    const cmds = buildSuspendCommands({
      customerId: 'c-1',
      customerName: 'Juan',
      ip: '10.10.0.5',
      pppoeUser: 'juan_1',
    });
    expect(cmds.some((c) => c.includes(`list=${NC_ADDR.authorized}`) && c.includes('remove'))).toBe(true);
    expect(cmds.some((c) => c.includes(`list=${NC_ADDR.suspended}`) && c.includes('add'))).toBe(true);
    expect(cmds.some((c) => c.includes('/ppp secret disable'))).toBe(true);
  });

  it('authorize limpia suspended/warning y mete nc-authorized', () => {
    const cmds = buildAuthorizeCommands({
      customerId: 'c-2',
      ip: '10.10.0.6',
    });
    expect(cmds.at(-1)).toContain(`list=${NC_ADDR.authorized}`);
  });

  it('warning no saca de authorized (solo marca aviso HTTP)', () => {
    const cmds = buildWarningCommands({ customerId: 'c-w', ip: '10.10.0.8' });
    expect(cmds.some((c) => c.includes(`list=${NC_ADDR.authorized}`) && c.includes('remove'))).toBe(false);
    expect(cmds.some((c) => c.includes(`list=${NC_ADDR.warning}`) && c.includes('add'))).toBe(true);
  });

  it('reactivate habilita PPP y autoriza', () => {
    const cmds = buildReactivateCommands({
      customerId: 'c-3',
      ip: '10.10.0.7',
      pppoeUser: 'ana',
    });
    expect(cmds.some((c) => c.includes('/ppp secret enable'))).toBe(true);
    expect(cmds.some((c) => c.includes(`list=${NC_ADDR.authorized}`))).toBe(true);
  });

  it('plantilla factory incluye ACL NAT/filter nc-* y drop unauthorized', () => {
    const { script } = generateFromTemplate({
      templateId: 'router_base_wireguard',
      routerName: 'chr-test',
      routerosVersion: '7',
      applyMode: 'factory_reset',
      wgServerPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      wgEndpoint: '1.2.3.4:13231',
      wgRouterIp: '10.70.0.2',
    });
    expect(script).toContain('nc-authorized');
    expect(script).toContain('nc-suspended');
    expect(script).toContain('NugaCore ACL allow authorized');
    expect(script).toContain('NugaCore ACL suspend TCP');
    expect(script).toContain('NugaCore ACL drop unauthorized');
  });

  it('plantilla existing_config omite drop unauthorized', () => {
    const { script } = generateFromTemplate({
      templateId: 'router_base_wireguard',
      routerName: 'chr-live',
      routerosVersion: '7',
      applyMode: 'existing_config',
      wgServerPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      wgEndpoint: '1.2.3.4:13231',
      wgRouterIp: '10.70.0.2',
    });
    expect(script).toContain('NugaCore ACL allow authorized');
    expect(script).not.toContain('NugaCore ACL drop unauthorized');
  });
});
