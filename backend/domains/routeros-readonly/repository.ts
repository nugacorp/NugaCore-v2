import {
  RouterOsIdentity,
  RouterOsInterfaceSummary,
  RouterOsRouteSummary,
  RouterOsSystemStatus,
  RouterOsWireGuardSummary,
} from './types';

export interface RouterOsReadOnlyProvider {
  getIdentity(): RouterOsIdentity;
  getSystem(): RouterOsSystemStatus;
  listInterfaces(): RouterOsInterfaceSummary[];
  listRoutes(): RouterOsRouteSummary[];
  getWireGuardSummary(): RouterOsWireGuardSummary;
}

const readonly = true as const;
const source = 'mock' as const;

export const mockRouterOsReadOnlyProvider: RouterOsReadOnlyProvider = {
  getIdentity(): RouterOsIdentity {
    return { name: 'nugacore-lab-router', source, readOnly: readonly };
  },

  getSystem(): RouterOsSystemStatus {
    return {
      version: 'RouterOS 7.15.3-lab-mock',
      uptime: '5d 04:17:33',
      cpu: { loadPercent: 12, cores: 2 },
      memory: { totalMiB: 256, freeMiB: 181, usedPercent: 29 },
      readOnly: readonly,
      source,
    };
  },

  listInterfaces(): RouterOsInterfaceSummary[] {
    return [
      { name: 'ether1-wan', type: 'ether', running: true, disabled: false, mtu: 1500, rxMbps: 18.4, txMbps: 5.1, readOnly: readonly },
      { name: 'bridge-lan', type: 'bridge', running: true, disabled: false, mtu: 1500, rxMbps: 9.7, txMbps: 8.2, readOnly: readonly },
      { name: 'wg-lab-readonly', type: 'wireguard', running: true, disabled: false, mtu: 1420, rxMbps: 1.2, txMbps: 0.9, readOnly: readonly },
    ];
  },

  listRoutes(): RouterOsRouteSummary[] {
    return [
      { dstAddress: '0.0.0.0/0', gateway: '198.51.100.1', distance: 1, active: true, dynamic: false, readOnly: readonly },
      { dstAddress: '10.70.0.0/24', gateway: 'wg-lab-readonly', distance: 1, active: true, dynamic: false, readOnly: readonly },
      { dstAddress: '192.0.2.0/24', gateway: 'bridge-lan', distance: 0, active: true, dynamic: true, readOnly: readonly },
    ];
  },

  getWireGuardSummary(): RouterOsWireGuardSummary {
    return { enabled: true, interfaces: 1, peers: 2, activePeers: 1, readOnly: readonly, source };
  },
};
