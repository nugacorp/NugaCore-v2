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
import { processPendingOrders, readRouterSnapshot, listWorkerRuns } from './worker/worker';
import { getWireguardService } from '../wireguard/service';
import type { PeerCreatedOnce } from '../wireguard/types';

const router = Router();

// RBAC del provisioning (Fase 4.4)
const PROV_VIEW_ROLES = ['super admin', 'administrador', 'tecnico', 'soporte', 'solo lectura'] as const;
const PROV_SCRIPT_ROLES = ['super admin', 'administrador', 'tecnico'] as const;
const PROV_ROTATE_ROLES = ['super admin', 'administrador'] as const;

// Configuración de servidor/VPN de NugaCore (placeholders seguros si no hay env).
const buildServerConfig = (overrides: Partial<ScriptServerConfig> = {}): ScriptServerConfig => {
  const vpnHost = overrides.vpnServerHost || overrides.vpnHost || process.env.MIKROTIK_VPN_HOST || 'vpn.nugacore.local';
  const vpnCidr = overrides.vpnNetworkCidr || overrides.vpnCidr || process.env.MIKROTIK_VPN_CIDR || '10.10.0.0/24';
  const mgmtCidr = overrides.serverManagementCidr || process.env.MIKROTIK_MGMT_CIDR || '10.0.0.0/24';
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
    allowedApiCidr: overrides.allowedApiCidr || process.env.MIKROTIK_ALLOWED_API_CIDR,
    routerOsVersionHint: overrides.routerOsVersionHint,
  };
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

const resolveRouterFromPayload = (routerId?: string) => {
  if (routerId) {
    return store.MIKROTIK_ROUTERS.find((routerItem) => routerItem.id === routerId) || null;
  }
  return store.MIKROTIK_ROUTERS[0] || null;
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

router.get('/api/mikrotik/routers', requireRoles([...PROV_VIEW_ROLES]), (_req, res) => {
  res.json(store.MIKROTIK_ROUTERS.map(fullRouterView));
});

router.get('/api/mikrotik/routers/:id', requireRoles([...PROV_VIEW_ROLES]), (req, res) => {
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json(fullRouterView(routerItem));
});

const VALID_CONNECTION_TYPES = ['wireguard', 'sstp', 'direct', 'zerotier', 'tailscale'] as const;

router.post('/api/mikrotik/routers', requireRoles(['super admin', 'administrador']), (req, res) => {
  const { name, ipAddress, managementIp, apiPort, apiSslPort, username, password, linkedTowerId, connectionType, vpnIp, notes, routerOsVersion } = req.body;

  const mgmt = managementIp ?? ipAddress;
  if (!name || !mgmt) {
    return res.status(400).json({ error: 'Missing required fields: name, managementIp (o ipAddress)' });
  }
  if (connectionType !== undefined && !VALID_CONNECTION_TYPES.includes(String(connectionType) as never)) {
    return res.status(400).json({ error: 'Invalid connectionType' });
  }

  const duplicatedIp = store.MIKROTIK_ROUTERS.some((row) => row.ipAddress === String(mgmt));
  if (duplicatedIp) {
    return res.status(409).json({ error: 'Router IP already registered' });
  }

  const id = store.getUniqueMikrotikRouterId();
  // Credenciales: NO se exige password manual. Username auto si no se da; el
  // password real se genera al emitir el script de provisioning.
  const resolvedUser = username ? String(username) : generateApiUsername(id);
  const encryptedPassword = password ? encryptSecret(String(password)) : '';

  const routerItem: MikrotikRouterRegistryItem = {
    id,
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
    connectionType: connectionType ? (String(connectionType) as MikrotikRouterRegistryItem['connectionType']) : 'sstp',
    managementIp: String(mgmt),
    vpnIp: vpnIp ? String(vpnIp) : undefined,
    apiSslPort: Number(apiSslPort) || 8729,
    provisioningStatus: 'pending',
    notes: notes ? String(notes) : undefined,
  };

  store.MIKROTIK_ROUTERS.push(routerItem);
  provisioningStore.recordAudit({
    routerId: id,
    action: 'create',
    dryRun: false,
    status: 'executed',
    actorId: req.authContext?.userId,
    requestPayload: { name: routerItem.name, connectionType: routerItem.connectionType },
    resultSummary: `Router ${id} registrado (${routerItem.connectionType}).`,
  });
  res.status(201).json(fullRouterView(routerItem));
});

router.put('/api/mikrotik/routers/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const index = store.MIKROTIK_ROUTERS.findIndex((row) => row.id === req.params.id);
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

router.delete('/api/mikrotik/routers/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const existing = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Router not found' });
  }

  store.MIKROTIK_ROUTERS = store.MIKROTIK_ROUTERS.filter((row) => row.id !== req.params.id);
  res.status(204).send();
});

router.get('/api/mikrotik/routers/:id/health', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
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
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json({
    routerId: routerItem.id,
    data: getSimulatedCommandOutput('/interface print', routerItem.id),
  });
});

router.get('/api/mikrotik/routers/:id/read/queues', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json({
    routerId: routerItem.id,
    data: getSimulatedCommandOutput('/queue simple print', routerItem.id),
  });
});

router.get('/api/mikrotik/routers/:id/read/ppp', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
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

  const routerItem = resolveRouterFromPayload(routerId);
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

  // Integración con el WireGuard Manager (Fase 4.6.1): si se indica un
  // wireguardServerId y el modo es WireGuard administrado, NugaCore asigna el
  // peer (claves + IP) y lo incrusta en el script (sin intercambio manual).
  let wgPeer: PeerCreatedOnce | undefined;
  if (requestedMode === 'wireguard_managed' && body.wireguardServerId) {
    try {
      wgPeer = await getWireguardService().getPeerConfigForRouter(routerItem.id, String(body.wireguardServerId), actorId);
      const [host, port] = wgPeer.serverEndpoint.split(':');
      server.wgServerPublicKey = wgPeer.serverPublicKey;
      server.vpnServerHost = host || server.vpnServerHost;
      server.vpnServerPort = Number(port) || server.vpnServerPort;
      server.routerVpnIp = wgPeer.assignedIp;
      server.wgAllowedAddress = wgPeer.allowedCidr;
      server.serverManagementCidr = wgPeer.allowedCidr || server.serverManagementCidr;
      server.wgRouterPrivateKey = wgPeer.privateKey || undefined;
      server.wgPresharedKey = wgPeer.presharedKey || undefined;
    } catch {
      // Si falla, el script se genera con placeholders (modo manual).
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
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
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
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
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
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
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
