import { Router } from 'express';
import { getGemini } from '../../../backend/services/gemini';
import { encryptSecret } from '../../../backend/services/crypto';
import { store, MikrotikRouterRegistryItem } from '../../../backend/state/store';
import { READ_ROLES, requireRoles } from '../../common/rbac';
import { generateApiCredential, generateApiUsername, generateProvisioningToken } from './provisioning/credentials';
import { generateProvisioningScript } from './provisioning/script-generator';
import { provisioningStore, toProvisionedView } from './provisioning/store';
import {
  ScriptServerConfig,
  PROVISIONING_MODES,
  modeToConnectionType,
  normalizeProvisioningMode,
} from './provisioning/types';
import { asyncHandler } from '../../common/errors';
import { logger } from '../../common/logger';
import { processPendingOrders, readRouterSnapshot, listWorkerRuns } from './worker/worker';
import { getWireguardService } from '../wireguard/service';
import type { PeerCreatedOnce } from '../wireguard/types';
import { persistMikrotikRouter } from './repository';
import { enrollmentService } from '../router-enrollment/service';
import { tenantIdFromRequest } from '../tenancy/tenant-scope';
import { filterRoutersByTenant, findRouterForTenant } from './tenant-filter';

const router = Router();

// RBAC del provisioning (Fase 4.4)
// Vista de provisioning/inventario MikroTik: excluye Cobranza y Solo-lectura
// (hardening P0 RBAC — la lectura de red es de operación técnica).
const PROV_VIEW_ROLES = ['super admin', 'administrador', 'tecnico', 'soporte'] as const;
const PROV_SCRIPT_ROLES = ['super admin', 'administrador', 'tecnico'] as const;
const PROV_ROTATE_ROLES = ['super admin', 'administrador'] as const;

// Configuración de servidor/VPN de NugaCore (placeholders seguros si no hay env).
const buildServerConfig = (overrides: Partial<ScriptServerConfig> = {}): ScriptServerConfig => {
  const vpnHost = overrides.vpnServerHost || overrides.vpnHost || process.env.MIKROTIK_VPN_HOST || 'vpn.nugacore.local';
  const vpnCidr = overrides.vpnNetworkCidr || overrides.vpnCidr || process.env.MIKROTIK_VPN_CIDR || '10.70.0.0/16';
  const mgmtCidr = overrides.serverManagementCidr || process.env.MIKROTIK_MGMT_CIDR || vpnCidr;
  return {
    // Compatibilidad (Fase 4.4)
    vpnHost,
    vpnCidr,
    serverManagementCidr: mgmtCidr,
    wgServerPublicKey: overrides.wgServerPublicKey || process.env.MIKROTIK_WG_SERVER_PUBKEY,
    wgEndpoint: overrides.wgEndpoint || process.env.MIKROTIK_WG_ENDPOINT,
    wgAllowedAddress: overrides.wgAllowedAddress,
    wgInterfaceAddress: overrides.wgInterfaceAddress,
    wgKeepalive: overrides.wgKeepalive,
    // Modelo administrado (Fase 4.6.0)
    vpnServerHost: vpnHost,
    vpnServerPort: overrides.vpnServerPort || Number(process.env.MIKROTIK_VPN_SERVER_PORT) || undefined,
    vpnNetworkCidr: vpnCidr,
    routerVpnIp: overrides.routerVpnIp,
    serverVpnIp: overrides.serverVpnIp || process.env.MIKROTIK_VPN_SERVER_IP,
    allowedApiCidr: overrides.allowedApiCidr || process.env.MIKROTIK_ALLOWED_API_CIDR || vpnCidr,
    routerOsVersionHint: overrides.routerOsVersionHint,
  };
};

/** Completa server config desde el WireGuard Manager (servidor default o indicado). */
const enrichServerFromWireguard = async (
  server: ScriptServerConfig,
  serverId?: string,
): Promise<string | undefined> => {
  const wgSvc = getWireguardService();
  const wgServer = serverId ? await wgSvc.findServer(serverId) : await wgSvc.getDefaultServer();
  if (!wgServer) return undefined;

  server.wgServerPublicKey = server.wgServerPublicKey || wgServer.publicKey;
  server.vpnServerHost = server.vpnServerHost || wgServer.endpointHost;
  server.vpnServerPort = server.vpnServerPort || wgServer.endpointPort;
  server.vpnNetworkCidr = server.vpnNetworkCidr || wgServer.vpnCidr;
  server.serverManagementCidr = server.serverManagementCidr || wgServer.vpnCidr;
  server.allowedApiCidr = server.allowedApiCidr || wgServer.vpnCidr;
  server.serverVpnIp = server.serverVpnIp || wgServer.serverVpnIp;
  return wgServer.id;
};

const nowStamp = () => new Date().toISOString().replace('T', ' ').substring(0, 16);

const sanitizeRouter = (routerItem: {
  id: string;
  name: string;
  ipAddress: string;
  apiPort: number;
  username: string;
  encryptedPassword: string;
  isOnline: boolean;
  cpuUsagePct: number;
  memoryUsagePct: number;
  routerOsVersion: string;
  linkedTowerId?: string;
  lastHealthCheckAt: string;
}) => ({
  id: routerItem.id,
  name: routerItem.name,
  ipAddress: routerItem.ipAddress,
  apiPort: routerItem.apiPort,
  username: routerItem.username,
  hasCredentials: !!routerItem.encryptedPassword,
  isOnline: routerItem.isOnline,
  cpuUsagePct: routerItem.cpuUsagePct,
  memoryUsagePct: routerItem.memoryUsagePct,
  routerOsVersion: routerItem.routerOsVersion,
  linkedTowerId: routerItem.linkedTowerId,
  lastHealthCheckAt: routerItem.lastHealthCheckAt,
});

// Vista combinada: campos legacy + campos de provisioning (sin secretos).
const fullRouterView = (routerItem: (typeof store.MIKROTIK_ROUTERS)[number]) => ({
  ...sanitizeRouter(routerItem),
  ...toProvisionedView(routerItem),
});

const isReadOnlyCommand = (command: string): boolean => {
  const cmd = command.trim().toLowerCase();
  return (
    cmd.startsWith('/system resource print') ||
    cmd.startsWith('system resource print') ||
    cmd.startsWith('/ip address print') ||
    cmd.startsWith('ip address print') ||
    cmd.startsWith('/ppp active print') ||
    cmd.startsWith('ppp active print') ||
    cmd.startsWith('/queue simple print') ||
    cmd.startsWith('queue simple print') ||
    cmd.startsWith('/interface print') ||
    cmd.startsWith('interface print') ||
    cmd.startsWith('/ip route print') ||
    cmd.startsWith('ip route print')
  );
};

const resolveRouterFromPayload = (routerId: string | undefined, tenantId: string) => {
  const scoped = filterRoutersByTenant(store.MIKROTIK_ROUTERS, tenantId);
  if (routerId) {
    return scoped.find((routerItem) => routerItem.id === routerId) || null;
  }
  return scoped[0] || null;
};

const logMikrotikAudit = (params: {
  routerId?: string;
  routerName?: string;
  command: string;
  mode: 'read' | 'write';
  status: 'allowed' | 'blocked' | 'executed';
  executedBy?: string;
  message: string;
}) => {
  store.logMikrotikCommandAudit(params);
};

const getSimulatedCommandOutput = (command: string, routerId?: string): string => {
  const cmd = command.trim();

  if (cmd.startsWith('/system resource print') || cmd.startsWith('system resource print')) {
    const ver = routerId === 'mkt-2' ? '7.14.2 (stable)' : routerId === 'mkt-3' ? '6.49 (stable)' : '7.12 (stable)';
    const cpuType = routerId === 'mkt-2' ? 'tile' : routerId === 'mkt-3' ? 'mipsbe' : 'arm64';
    const cpuCount = routerId === 'mkt-2' ? '16' : routerId === 'mkt-3' ? '1' : '4';
    const cpuLoad = routerId === 'mkt-2' ? '52%' : routerId === 'mkt-3' ? '18%' : '8%';
    const freeMem = routerId === 'mkt-2' ? '12480MB' : routerId === 'mkt-3' ? '24MB' : '680MB';
    const totMem = routerId === 'mkt-2' ? '16384MB' : routerId === 'mkt-3' ? '64MB' : '1024MB';

    return `uptime: 45d 12h 30m
version: ${ver}
cpu: ${cpuType}
cpu-count: ${cpuCount}
cpu-load: ${cpuLoad}
free-memory: ${freeMem}
total-memory: ${totMem}`;
  }

  if (cmd.startsWith('/ip address print') || cmd.startsWith('ip address print')) {
    if (routerId === 'mkt-2') {
      return `Flags: D - dynamic, X - disabled, I - invalid, A - active
 #   ADDRESS            NETWORK         INTERFACE
  0   10.0.1.3/24        10.0.1.0        ether1-WAN-FIBER
  1   10.200.10.1/24     10.200.10.0     vlan50-Clientes-Sur`;
    }

    if (routerId === 'mkt-3') {
      return `Flags: D - dynamic, X - disabled, I - invalid, A - active
 #   ADDRESS            NETWORK         INTERFACE
  0   10.0.1.5/24        10.0.1.0        ether1-UPLINK
  1   192.168.88.1/24    192.168.88.0    ether2-local`;
    }
  }

  if (cmd.startsWith('/ppp active print') || cmd.startsWith('ppp active print')) {
    return `Flags: R - running
 #   NAME                      SERVICE   CALLER-ID         ADDRESS         UPTIME
 0 R sofia_rodriguez_nuga      pppoe     BC:E6:7C:12:34:56  10.100.10.12    05:42:19
 1 R school_benito_juarez_nuga pppoe     E0:3F:49:FF:22:98  10.100.10.88    22:11:05`;
  }

  if (cmd.startsWith('/queue simple print') || cmd.startsWith('queue simple print')) {
    return `Flags: X - disabled, I - invalid, D - dynamic
 #      NAME                               RATE         LIMIT-AT      MAX-LIMIT
 0  D   sofia_rodriguez_nuga_limit        1.2M/15.4M   10M/50M       10M/50M
 1  D   school_benito_juarez_nuga_limit   512k/4.1M    2M/20M        2M/20M
 2  X   rodrigo_flores_nuga_suspended     0/0          1M/1M         512k/512k`;
  }

  if (cmd.startsWith('/interface print') || cmd.startsWith('interface print')) {
    return `Flags: D - dynamic, X - disabled, R - running, S - slave
 #    NAME                  TYPE       MTU   ACTUAL-MTU  L2MTU
 0  R ether1-WAN           ether      1500  1500        1598
 1  R ether2-LAN           ether      1500  1500        1598
 2  R sfp-sfpplus1         ether      1500  1500        1600`;
  }

  if (cmd.startsWith('/ip route print') || cmd.startsWith('ip route print')) {
    return `Flags: D - dynamic, A - active, c - connect, s - static
 #      DST-ADDRESS        GATEWAY          DISTANCE
 0  A S 0.0.0.0/0          10.0.1.254       1
 1  A c 10.0.1.0/24        ether1-WAN       0`;
  }

  return `Command executed successfully on WISP Core.
Output: [RouterOS simulated mode]
Script trigger OK. Modified address-list counters.`;
};

router.get('/api/mikrotik/routers', requireRoles([...PROV_VIEW_ROLES]), (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  res.json(filterRoutersByTenant(store.MIKROTIK_ROUTERS, tenantId).map(fullRouterView));
});

router.get('/api/mikrotik/routers/vpn-ip-preview', requireRoles(['super admin', 'administrador', 'tecnico']), asyncHandler(async (req, res) => {
  const mode = String(req.query.connectionType || 'wireguard');
  if (mode !== 'wireguard' && mode !== 'wireguard_managed') {
    res.status(400).json({ error: 'vpn-ip-preview solo aplica a connectionType wireguard' });
    return;
  }
  try {
    res.json(await getWireguardService().previewNextIp(undefined, tenantIdFromRequest(req)));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'No se pudo obtener IP VPN' });
  }
}));

router.get('/api/mikrotik/routers/:id', requireRoles([...PROV_VIEW_ROLES]), (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json(fullRouterView(routerItem));
});

const VALID_CONNECTION_TYPES = ['wireguard', 'sstp', 'direct', 'zerotier', 'tailscale'] as const;

router.post('/api/mikrotik/routers', requireRoles(['super admin', 'administrador']), asyncHandler(async (req, res) => {
  const { name, ipAddress, managementIp, apiPort, apiSslPort, username, password, linkedTowerId, connectionType, vpnIp, notes, routerOsVersion } = req.body;
  const tenantId = tenantIdFromRequest(req);

  const connType = connectionType ? String(connectionType) : 'sstp';
  if (!VALID_CONNECTION_TYPES.includes(connType as never)) {
    res.status(400).json({ error: 'Invalid connectionType' });
    return;
  }

  const isWireguard = connType === 'wireguard';
  let mgmt = managementIp ?? ipAddress;

  if (!name) {
    res.status(400).json({ error: 'Missing required field: name' });
    return;
  }
  if (!isWireguard && !mgmt) {
    res.status(400).json({ error: 'Missing required fields: name, managementIp (o ipAddress)' });
    return;
  }

  const id = store.getUniqueMikrotikRouterId();
  let assignedVpnIp: string | undefined;
  let wireguardMeta: { peerId: string; serverId: string; assignedIp: string; autoAssigned: true } | undefined;

  if (isWireguard) {
    try {
      const defaultServer = await getWireguardService().getDefaultServer(tenantId);
      if (!defaultServer) {
        res.status(400).json({ error: 'No hay servidor WireGuard default. Configura uno en WireGuard Manager.' });
        return;
      }
      const peer = await getWireguardService().createPeer(
        { serverId: defaultServer.id, name: String(name), routerId: id, tenantId },
        req.authContext?.userId,
      );
      assignedVpnIp = peer.peer.allocatedIp;
      mgmt = peer.peer.allocatedIp;
      wireguardMeta = {
        peerId: peer.peer.id,
        serverId: defaultServer.id,
        assignedIp: peer.peer.allocatedIp,
        autoAssigned: true,
      };
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'No se pudo asignar IP WireGuard' });
      return;
    }
  } else {
    mgmt = String(mgmt);
    const duplicatedIp = filterRoutersByTenant(store.MIKROTIK_ROUTERS, tenantId)
      .some((row) => row.ipAddress === mgmt);
    if (duplicatedIp) {
      res.status(409).json({ error: 'Router IP already registered' });
      return;
    }
  }

  const resolvedUser = username ? String(username) : generateApiUsername(id);
  const encryptedPassword = password ? encryptSecret(String(password)) : '';

  const routerItem: MikrotikRouterRegistryItem = {
    id,
    tenantId,
    name: String(name),
    ipAddress: String(mgmt),
    apiPort: Number(apiPort) || 8728,
    username: resolvedUser,
    encryptedPassword,
    isOnline: true,
    cpuUsagePct: 0,
    memoryUsagePct: 0,
    routerOsVersion: routerOsVersion ? String(routerOsVersion) : '7.x',
    linkedTowerId: linkedTowerId ? String(linkedTowerId) : undefined,
    lastHealthCheckAt: nowStamp(),
    connectionType: connType as MikrotikRouterRegistryItem['connectionType'],
    managementIp: String(mgmt),
    vpnIp: assignedVpnIp ?? (vpnIp ? String(vpnIp) : undefined),
    apiSslPort: Number(apiSslPort) || 8729,
    provisioningStatus: 'pending',
    notes: notes ? String(notes) : undefined,
  };

  store.MIKROTIK_ROUTERS.push(routerItem);
  try {
    await persistMikrotikRouter(routerItem);
  } catch (err) {
    store.MIKROTIK_ROUTERS = store.MIKROTIK_ROUTERS.filter((r) => r.id !== id);
    res.status(500).json({ error: err instanceof Error ? err.message : 'No se pudo persistir el router' });
    return;
  }
  provisioningStore.recordAudit({
    routerId: id,
    action: 'create',
    dryRun: false,
    status: 'executed',
    actorId: req.authContext?.userId,
    requestPayload: { name: routerItem.name, connectionType: routerItem.connectionType, ...(wireguardMeta ? { wireguardPeerId: wireguardMeta.peerId } : {}) },
    resultSummary: wireguardMeta
      ? `Router ${id} registrado (wireguard, IP ${wireguardMeta.assignedIp} auto-asignada).`
      : `Router ${id} registrado (${routerItem.connectionType}).`,
  });
  res.status(201).json({
    ...fullRouterView(routerItem),
    ...(wireguardMeta ? { wireguard: wireguardMeta } : {}),
  });
}));

router.put('/api/mikrotik/routers/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const tenantId = tenantIdFromRequest(req);
  const index = store.MIKROTIK_ROUTERS.findIndex(
    (row) => row.id === req.params.id && (row.tenantId || 'tenant-default') === tenantId,
  );
  if (index === -1) {
    return res.status(404).json({ error: 'Router not found' });
  }
  const { connectionType } = req.body;
  if (connectionType !== undefined && !VALID_CONNECTION_TYPES.includes(String(connectionType) as never)) {
    return res.status(400).json({ error: 'Invalid connectionType' });
  }

  const current = store.MIKROTIK_ROUTERS[index];
  const { name, ipAddress, managementIp, apiPort, apiSslPort, username, password, linkedTowerId, isOnline, vpnIp, notes, routerOsVersion, status } = req.body;
  store.MIKROTIK_ROUTERS[index] = {
    ...current,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(ipAddress !== undefined ? { ipAddress: String(ipAddress) } : {}),
    ...(managementIp !== undefined ? { managementIp: String(managementIp), ipAddress: String(managementIp) } : {}),
    ...(apiPort !== undefined ? { apiPort: Number(apiPort) || current.apiPort } : {}),
    ...(apiSslPort !== undefined ? { apiSslPort: Number(apiSslPort) || current.apiSslPort } : {}),
    ...(username !== undefined ? { username: String(username) } : {}),
    ...(password !== undefined ? { encryptedPassword: encryptSecret(String(password)) } : {}),
    ...(linkedTowerId !== undefined ? { linkedTowerId: linkedTowerId ? String(linkedTowerId) : undefined } : {}),
    ...(isOnline !== undefined ? { isOnline: Boolean(isOnline) } : {}),
    ...(connectionType !== undefined ? { connectionType: String(connectionType) as never } : {}),
    ...(vpnIp !== undefined ? { vpnIp: vpnIp ? String(vpnIp) : undefined } : {}),
    ...(notes !== undefined ? { notes: notes ? String(notes) : undefined } : {}),
    ...(routerOsVersion !== undefined ? { routerOsVersion: String(routerOsVersion) } : {}),
    ...(status !== undefined ? { provisioningStatus: String(status) as never } : {}),
    lastHealthCheckAt: nowStamp(),
  };

  res.json(fullRouterView(store.MIKROTIK_ROUTERS[index]));
});

router.delete(
  '/api/mikrotik/routers/:id',
  requireRoles(['super admin', 'administrador']),
  asyncHandler(async (req, res) => {
    const actorId = req.authContext?.userId ?? 'unknown';
    const tenantId = tenantIdFromRequest(req);
    if (!findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantId)) {
      return res.status(404).json({ error: 'Router not found' });
    }
    const result = await enrollmentService.purgeByRouterId(req.params.id, actorId, tenantId);
    if (!result.found) {
      return res.status(404).json({ error: 'Router not found' });
    }
    res.status(204).send();
  }),
);

router.get('/api/mikrotik/routers/:id/health', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }

  const linkedTower = routerItem.linkedTowerId
    ? store.TOWERS.find((tower) => tower.id === routerItem.linkedTowerId)
    : null;

  if (linkedTower) {
    routerItem.isOnline = linkedTower.status !== 'offline';
    routerItem.cpuUsagePct = linkedTower.cpu;
    routerItem.memoryUsagePct = linkedTower.ram;
  } else {
    routerItem.isOnline = true;
    routerItem.cpuUsagePct = Math.max(1, Math.floor(Math.random() * 75));
    routerItem.memoryUsagePct = Math.max(1, Math.floor(Math.random() * 80));
  }

  routerItem.lastHealthCheckAt = nowStamp();

  res.json({
    ...sanitizeRouter(routerItem),
    diagnostics: {
      latencyMs: linkedTower?.pingMs ?? Math.floor(Math.random() * 30 + 5),
      lastHealthCheckAt: routerItem.lastHealthCheckAt,
      mode: 'simulated-readonly',
    },
  });
});

router.get('/api/mikrotik/routers/:id/read/interfaces', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json({
    routerId: routerItem.id,
    data: getSimulatedCommandOutput('/interface print', routerItem.id),
  });
});

router.get('/api/mikrotik/routers/:id/read/queues', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json({
    routerId: routerItem.id,
    data: getSimulatedCommandOutput('/queue simple print', routerItem.id),
  });
});

router.get('/api/mikrotik/routers/:id/read/ppp', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json({
    routerId: routerItem.id,
    data: getSimulatedCommandOutput('/ppp active print', routerItem.id),
  });
});

router.get('/api/mikrotik/command-audit', requireRoles(['super admin', 'administrador', 'tecnico']), (req, res) => {
  const routerId = String(req.query.routerId || '').trim();
  const rows = routerId
    ? store.MIKROTIK_COMMAND_AUDIT.filter((row) => row.routerId === routerId)
    : store.MIKROTIK_COMMAND_AUDIT;
  res.json(rows);
});

router.get('/api/mikrotik/logs', requireRoles(READ_ROLES), (_req, res) => {
  res.json(store.MIKROTIK_LOGS);
});

router.post('/api/mikrotik/command', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const { command, routerId, confirmWrite } = req.body;
  if (!command) return res.status(400).json({ error: 'No query command' });

  const routerItem = resolveRouterFromPayload(
    routerId ? String(routerId) : undefined,
    tenantIdFromRequest(req),
  );
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }

  const mode: 'read' | 'write' = isReadOnlyCommand(String(command)) ? 'read' : 'write';
  const actorId = req.authContext?.userId;
  if (mode === 'write' && confirmWrite !== true) {
    logMikrotikAudit({
      routerId: routerItem.id,
      routerName: routerItem.name,
      command: String(command),
      mode,
      status: 'blocked',
      executedBy: actorId,
      message: 'Write command blocked. Set confirmWrite=true to execute.',
    });
    return res.status(403).json({ error: 'Write command blocked. Send confirmWrite=true for explicit confirmation.' });
  }

  if (mode === 'write' && /reboot|reset\s+configuration|system\s+reset/i.test(String(command))) {
    logMikrotikAudit({
      routerId: routerItem.id,
      routerName: routerItem.name,
      command: String(command),
      mode,
      status: 'blocked',
      executedBy: actorId,
      message: 'Destructive command blocked by policy.',
    });
    return res.status(403).json({ error: 'Destructive command blocked by safety policy.' });
  }

  logMikrotikAudit({
    routerId: routerItem.id,
    routerName: routerItem.name,
    command: String(command),
    mode,
    status: 'allowed',
    executedBy: actorId,
    message: 'Command allowed for execution.',
  });

  const output = getSimulatedCommandOutput(String(command), routerItem.id);

  store.MIKROTIK_LOGS.push({
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    message: `user,info [${routerItem.name}] Command (${mode}): "${String(command)}"`,
  });

  logMikrotikAudit({
    routerId: routerItem.id,
    routerName: routerItem.name,
    command: String(command),
    mode,
    status: 'executed',
    executedBy: actorId,
    message: 'Command executed in simulated mode.',
  });

  res.json({ output });
});

router.post('/api/mikrotik/copilot', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

  try {
    const aiInstance = getGemini();
    const systemInstruction = `
      Eres el NugaCore Copiloto IA, un experto mundial en administracion de MikroTik RouterOS v6, v7, redes GPON/EPON y soporte tecnico para WISPs (Internet Service Providers).
      Ayudas a tecnicos de campo a proveer configuraciones limpias, scripts seguros de suspension, queues simples (Simple Queues), queues hijas, tuneles PPPoE, Hotspots, cortes automaticos, y diagnostico avanzado de latencia/perdida de paquetes.

      Reglas de respuesta:
      - Responde con un tono altamente tecnico, profesional y pragmatico para un administrador de red de telecomunicaciones.
      - Cuando se solicite un script RouterOS, proporcionalo en bloques de codigo limpios con comentarios utiles.
      - Manten explicaciones concisas. Enfocate directamente en la solucion tecnica.
      - Si el prompt incluye un diagnostico (ej: un cliente con senal de -28dBm de fibra o IP con perdida de paquetes), da el checklist exacto para que el tecnico lo resuelva en la antena, OLT o conector.
    `;

    const response = await aiInstance.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.3,
      },
    });

    res.json({ text: response.text });
  } catch (_err: unknown) {
    res.json({
      text: `### NugaCore [FALLBACK COPILOTT]
No se pudo comunicar con el modelo de IA debido a que el API Key no esta configurado (o es incorrecto). No obstante, aqui tienes un Script RouterOS pre-generado estandar para tu peticion:

\`\`\`routeros
# Script de suspension automatizada NugaCore WISP
/queue simple {
  set [find name="rodrigo_flores_nuga_suspended"] max-limit=128k/128k comment="SUSPENDIDO_FALTA_DE_PAGO"
}
/ip firewall address-list {
  add list=SUSPENDIDOS address=10.100.10.45 comment="RODRIGO_FLORES_CORTE_AUTO"
}
# Redirigir trafico HTTP al Portal de Suspension de NugaCore
/ip firewall nat {
  add action=dst-nat chain=dstnat dst-port=80,443 protocol=tcp src-address-list=SUSPENDIDOS to-addresses=192.168.10.1 to-ports=3000
}
\`\`\`
*Para habilitar las respuestas contextuales ilimitadas del Copiloto Gemini v3.5, introduce tu \`GEMINI_API_KEY\` en el panel de **Secrets > Settings**.*`,
    });
  }
});

// ────────────────────────────────────────────────────────────────────
// Provisioning (Fase 4.4) — genera credenciales + script RouterOS.
// El script (con secretos) se devuelve UNA sola vez; solo se persiste su
// hash/metadata. Nunca se loguea el script ni los passwords.
// ────────────────────────────────────────────────────────────────────
const emitProvisioning = async (
  routerItem: (typeof store.MIKROTIK_ROUTERS)[number],
  body: Record<string, unknown>,
  actorId: string | undefined,
  action: 'generate_script' | 'rotate_credentials',
) => {
  // Modo administrado (acepta los 4 modos + alias legacy 'wireguard'/'sstp').
  const requestedMode = body.connectionType
    ? normalizeProvisioningMode(String(body.connectionType))
    : normalizeProvisioningMode(routerItem.connectionType || 'wireguard');
  const baseConnectionType = modeToConnectionType(requestedMode);
  const isSstp = requestedMode === 'sstp_managed';
  const apiMode = body.apiMode === 'read_only' || body.apiMode === 'operator' ? body.apiMode : undefined;

  // Credencial API (password fuerte, cifrado).
  const apiCred = generateApiCredential(routerItem.id);
  // Credencial VPN (solo SSTP la usa en el script).
  const vpnCred = generateApiCredential(`vpn${routerItem.id}`);

  // Persistir credencial cifrada en el registro (NUNCA el password en claro).
  routerItem.username = apiCred.username;
  routerItem.encryptedPassword = apiCred.encryptedPassword;
  routerItem.encryptionVersion = apiCred.encryptionVersion;
  routerItem.credentialRotatedAt = new Date().toISOString();
  routerItem.connectionType = baseConnectionType;
  routerItem.provisioningStatus = 'provisioned';
  routerItem.lastHealthCheckAt = nowStamp();

  const serverOverrides = (body.server && typeof body.server === 'object' ? body.server : {}) as Partial<ScriptServerConfig>;
  const server = buildServerConfig(serverOverrides);

  // Integración con el WireGuard Manager (Fase 4.6.1): en modo WireGuard
  // administrado, NugaCore asigna el peer (claves + IP) usando el servidor
  // indicado o el default del pool. Si falla, NO se entrega script con placeholders.
  let wgPeer: PeerCreatedOnce | undefined;
  if (requestedMode === 'wireguard_managed') {
    const hintedServerId = body.wireguardServerId ? String(body.wireguardServerId) : undefined;
    const serverId = (await enrichServerFromWireguard(server, hintedServerId))
      ?? (await getWireguardService().getDefaultServer())?.id;

    if (!serverId) {
      throw new Error('No hay servidor WireGuard default. Configura uno en WireGuard Manager.');
    }

    try {
      wgPeer = await getWireguardService().getPeerConfigForRouter(routerItem.id, serverId, actorId);
      const [host, port] = wgPeer.serverEndpoint.split(':');
      server.wgServerPublicKey = wgPeer.serverPublicKey;
      server.vpnServerHost = host || server.vpnServerHost;
      server.vpnServerPort = Number(port) || server.vpnServerPort;
      server.routerVpnIp = wgPeer.assignedIp;
      server.wgAllowedAddress = wgPeer.allowedCidr;
      server.serverManagementCidr = wgPeer.allowedCidr || server.serverManagementCidr;
      server.wgRouterPrivateKey = wgPeer.privateKey || undefined;
      server.wgPresharedKey = wgPeer.presharedKey || undefined;
      routerItem.vpnIp = wgPeer.peer.allocatedIp;
      routerItem.managementIp = wgPeer.peer.allocatedIp;
      routerItem.ipAddress = wgPeer.peer.allocatedIp;
      body.wireguardServerId = serverId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'error desconocido';
      logger.warn('WireGuard provisioning: no se pudo resolver peer del router', {
        routerId: routerItem.id,
        serverId,
        error: message,
      });
      throw new Error(`No se pudo generar configuración WireGuard administrada: ${message}`, { cause: err });
    }
  }

  const result = generateProvisioningScript({
    connectionType: requestedMode,
    routerName: routerItem.name,
    apiUser: apiCred.username,
    apiPassword: apiCred.plainPassword,
    apiPort: routerItem.apiPort,
    vpnUser: vpnCred.username,
    vpnPassword: vpnCred.plainPassword,
    apiMode,
    server,
  });
  const connectionType = requestedMode;

  // Token de un solo uso + metadata del script (sin secretos).
  const token = generateProvisioningToken();
  provisioningStore.recordToken({
    routerId: routerItem.id,
    tokenHash: token.tokenHash,
    expiresAt: token.expiresAt,
    createdBy: actorId,
  });
  provisioningStore.recordScript({
    routerId: routerItem.id,
    scriptVersion: result.scriptVersion,
    connectionType: baseConnectionType,
    scriptHash: result.scriptHash,
    generatedBy: actorId,
  });
  provisioningStore.recordAudit({
    routerId: routerItem.id,
    action,
    dryRun: false,
    status: 'executed',
    actorId,
    requestPayload: { connectionType, routerName: routerItem.name },
    // Summary SIN secretos: solo usuario + hash del script (nunca el password).
    resultSummary: `Script ${result.scriptVersion} (${connectionType}) generado. user=${apiCred.username} hash=${result.scriptHash.substring(0, 12)}`,
  });

  // Respuesta: el script (mostrar una vez) + metadata. SIN passwords sueltos.
  return {
    router: fullRouterView(routerItem),
    script: result.script,
    scriptVersion: result.scriptVersion,
    scriptHash: result.scriptHash,
    connectionType,
    mode: result.mode,
    apiMode: result.apiMode,
    routerVpnIp: result.routerVpnIp,
    warnings: result.warnings,
    credentials: {
      apiUsername: apiCred.username,
      ...(isSstp ? { vpnUsername: vpnCred.username } : {}),
    },
    // Metadata del peer administrado (sin secretos: ya van dentro del script).
    ...(wgPeer
      ? {
          wireguard: {
            serverId: String(body.wireguardServerId),
            peerId: wgPeer.peer.id,
            assignedIp: wgPeer.assignedIp,
            peerPublicKey: wgPeer.peer.publicKey,
            managed: true,
          },
        }
      : {}),
    provisioningToken: token.token,
    tokenExpiresAt: token.expiresAt,
    securityWarning:
      'Guarda este script ahora: contiene secretos y NO se volverá a mostrar. ' +
      'Pégalo en RouterOS. NugaCore solo conserva el hash, nunca el script ni los passwords.',
  };
};

router.post('/api/mikrotik/routers/:id/provisioning-script', requireRoles([...PROV_SCRIPT_ROLES]), asyncHandler(async (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    res.status(404).json({ error: 'Router not found' });
    return;
  }
  if (
    req.body.connectionType !== undefined &&
    ![...PROVISIONING_MODES, 'wireguard', 'sstp'].includes(String(req.body.connectionType))
  ) {
    res.status(400).json({
      error: 'connectionType must be one of: wireguard_managed, sstp_managed, tailscale_lab, direct_lab (or legacy wireguard/sstp).',
    });
    return;
  }
  try {
    const payload = await emitProvisioning(routerItem, req.body || {}, req.authContext?.userId, 'generate_script');
    res.status(201).json(payload);
  } catch (err) {
    provisioningStore.recordAudit({
      routerId: routerItem.id,
      action: 'generate_script',
      dryRun: false,
      status: 'error',
      actorId: req.authContext?.userId,
      errorMessage: err instanceof Error ? err.message : 'unknown',
    });
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not generate script' });
  }
}));

router.post('/api/mikrotik/routers/:id/rotate-credentials', requireRoles([...PROV_ROTATE_ROLES]), asyncHandler(async (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    res.status(404).json({ error: 'Router not found' });
    return;
  }
  // Confirmación explícita obligatoria (rotación invalida la credencial previa).
  if (req.body?.confirm !== true) {
    res.status(400).json({ error: 'Confirmation required: send { "confirm": true } to rotate credentials.' });
    return;
  }
  const payload = await emitProvisioning(routerItem, req.body || {}, req.authContext?.userId, 'rotate_credentials');
  res.status(201).json(payload);
}));

router.post('/api/mikrotik/routers/:id/test-connection', requireRoles([...PROV_SCRIPT_ROLES]), (req, res) => {
  const routerItem = findRouterForTenant(store.MIKROTIK_ROUTERS, req.params.id, tenantIdFromRequest(req));
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  // DRY-RUN/MOCK: aún no hay worker. No se abre ninguna conexión real.
  const hasCreds = !!routerItem.encryptedPassword;
  const checks = [
    { name: 'router_registered', ok: true },
    { name: 'credentials_present', ok: hasCreds },
    { name: 'connection_type_set', ok: !!routerItem.connectionType },
    { name: 'api_port_valid', ok: routerItem.apiPort > 0 && routerItem.apiPort < 65536 },
  ];
  const reachable = checks.every((c) => c.ok);

  provisioningStore.recordAudit({
    routerId: routerItem.id,
    action: 'test_connection',
    dryRun: true,
    status: reachable ? 'executed' : 'blocked',
    actorId: req.authContext?.userId,
    requestPayload: { routerName: routerItem.name },
    resultSummary: `dry-run reachable=${reachable}`,
  });

  res.json({
    routerId: routerItem.id,
    dryRun: true,
    mode: 'dry-run',
    reachable,
    checks,
    message: reachable
      ? 'Dry-run OK: el router tiene credenciales y configuración válidas. La conexión real se validará con el Worker MikroTik (fase siguiente).'
      : 'Dry-run incompleto: faltan credenciales o tipo de conexión. Genera el script de provisioning primero.',
  });
});

// ════════════════════════════════════════════════════════════════════
// WORKER MIKROTIK (Fase 4.6) — Read Only + Dry Run.
// Consume órdenes PENDING y las procesa en dry-run (sin ejecutar, sin tocar
// client.status). Lecturas read-only (reales si MIKROTIK_WORKER_LIVE=true).
// ════════════════════════════════════════════════════════════════════

// Procesa las órdenes PENDING en dry-run.
router.post('/api/mikrotik/worker/run', requireRoles([...PROV_SCRIPT_ROLES]), asyncHandler(async (req, res) => {
  const run = await processPendingOrders(req.authContext?.userId);
  res.status(201).json(run);
}));

// Historial de corridas del worker.
router.get('/api/mikrotik/worker/runs', requireRoles([...PROV_VIEW_ROLES]), (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  res.json(listWorkerRuns(limit));
});

// Lectura read-only de un router (real o simulada).
router.get('/api/mikrotik/routers/:id/worker/read', requireRoles([...PROV_VIEW_ROLES]), asyncHandler(async (req, res) => {
  const snapshot = await readRouterSnapshot(req.params.id);
  if (!snapshot) {
    res.status(404).json({ error: 'Router not found' });
    return;
  }
  res.json(snapshot);
}));

export default router;
