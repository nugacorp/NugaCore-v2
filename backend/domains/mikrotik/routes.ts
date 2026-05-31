import { Router } from 'express';
import { getGemini } from '../../../backend/services/gemini';
import { encryptSecret } from '../../../backend/services/crypto';
import { store } from '../../../backend/state/store';
import { requireRoles } from '../../common/rbac';

const router = Router();

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

router.get('/api/mikrotik/routers', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (_req, res) => {
  res.json(store.MIKROTIK_ROUTERS.map(sanitizeRouter));
});

router.get('/api/mikrotik/routers/:id', requireRoles(['super admin', 'administrador', 'tecnico', 'soporte']), (req, res) => {
  const routerItem = store.MIKROTIK_ROUTERS.find((row) => row.id === req.params.id);
  if (!routerItem) {
    return res.status(404).json({ error: 'Router not found' });
  }
  res.json(sanitizeRouter(routerItem));
});

router.post('/api/mikrotik/routers', requireRoles(['super admin', 'administrador']), (req, res) => {
  const { name, ipAddress, apiPort, username, password, linkedTowerId } = req.body;

  if (!name || !ipAddress || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields: name, ipAddress, username, password' });
  }

  const duplicatedIp = store.MIKROTIK_ROUTERS.some((row) => row.ipAddress === String(ipAddress));
  if (duplicatedIp) {
    return res.status(409).json({ error: 'Router IP already registered' });
  }

  const encryptedPassword = encryptSecret(String(password));
  const routerItem = {
    id: store.getUniqueMikrotikRouterId(),
    name: String(name),
    ipAddress: String(ipAddress),
    apiPort: Number(apiPort) || 8728,
    username: String(username),
    encryptedPassword,
    isOnline: true,
    cpuUsagePct: 0,
    memoryUsagePct: 0,
    routerOsVersion: '7.x',
    linkedTowerId: linkedTowerId ? String(linkedTowerId) : undefined,
    lastHealthCheckAt: nowStamp(),
  };

  store.MIKROTIK_ROUTERS.push(routerItem);
  res.status(201).json(sanitizeRouter(routerItem));
});

router.put('/api/mikrotik/routers/:id', requireRoles(['super admin', 'administrador']), (req, res) => {
  const index = store.MIKROTIK_ROUTERS.findIndex((row) => row.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Router not found' });
  }

  const current = store.MIKROTIK_ROUTERS[index];
  const { name, ipAddress, apiPort, username, password, linkedTowerId, isOnline } = req.body;
  store.MIKROTIK_ROUTERS[index] = {
    ...current,
    ...(name !== undefined ? { name: String(name) } : {}),
    ...(ipAddress !== undefined ? { ipAddress: String(ipAddress) } : {}),
    ...(apiPort !== undefined ? { apiPort: Number(apiPort) || current.apiPort } : {}),
    ...(username !== undefined ? { username: String(username) } : {}),
    ...(password !== undefined ? { encryptedPassword: encryptSecret(String(password)) } : {}),
    ...(linkedTowerId !== undefined ? { linkedTowerId: linkedTowerId ? String(linkedTowerId) : undefined } : {}),
    ...(isOnline !== undefined ? { isOnline: Boolean(isOnline) } : {}),
    lastHealthCheckAt: nowStamp(),
  };

  res.json(sanitizeRouter(store.MIKROTIK_ROUTERS[index]));
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

router.get('/api/mikrotik/logs', (_req, res) => {
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

export default router;
