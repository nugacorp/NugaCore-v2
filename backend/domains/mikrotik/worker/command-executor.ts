// ====================================================================
// Ejecutor de comandos RouterOS planificados (modo commit / producción).
//
// Traduce los comandos CLI del worker a sentencias API binarias.
// Solo se invoca cuando MIKROTIK_WORKER_COMMIT=true.
// ====================================================================

import { decryptSecret } from '../../../services/crypto';
import { logger } from '../../../common/logger';
import { redactString } from '../../../common/secret-redaction';
import { MikrotikRouterRegistryItem } from '../../../state/store';
import { productionGates } from '../../../config/production-gates';
import { isWorkerApiTlsPreferred } from './connector';
import { RouterOsApiClient, RouterOsApiError, resolveRouterApiEndpoint } from './routeros-client';

const resolveHost = (router: MikrotikRouterRegistryItem): string =>
  router.vpnIp || router.managementIp || router.ipAddress;

const connectClient = async (router: MikrotikRouterRegistryItem): Promise<RouterOsApiClient> => {
  if (!router.encryptedPassword) {
    throw new RouterOsApiError('Router sin credenciales cifradas');
  }
  const password = decryptSecret(router.encryptedPassword);
  const endpoint = resolveRouterApiEndpoint({
    apiPort: router.apiPort,
    apiSslPort: router.apiSslPort,
    preferTls: isWorkerApiTlsPreferred(),
  });
  const client = new RouterOsApiClient({
    host: resolveHost(router),
    port: endpoint.port,
    username: router.username,
    password,
    useTls: endpoint.useTls,
    connectTimeoutMs: 8000,
    readTimeoutMs: 8000,
  });
  await client.connect();
  return client;
};

const findNameFromCommand = (command: string, key: 'name' | 'name~'): string | null => {
  const pattern = key === 'name'
    ? /name="([^"]+)"/
    : /name~"([^"]+)"/;
  const match = command.match(pattern);
  return match?.[1] ?? null;
};

const findCommentFromCommand = (command: string): string | null => {
  const match = command.match(/comment="([^"]+)"/);
  return match?.[1] ?? null;
};

const findAddressFromCommand = (command: string): string | null => {
  const match = command.match(/address=([^\s"]+)/);
  return match?.[1] ?? null;
};

const findListFromCommand = (command: string): string | null => {
  const match = command.match(/list=([^\s"]+)/);
  return match?.[1] ?? null;
};

async function executeOne(
  client: RouterOsApiClient,
  command: string,
): Promise<void> {
  // PPP secret disable/enable
  if (command.includes('/ppp secret disable')) {
    const name = findNameFromCommand(command, 'name');
    if (!name) throw new RouterOsApiError('No se pudo parsear name en comando PPP');
    const rows = await client.execute('/ppp/secret/print', {}, [`?name=${name}`]);
    const id = rows[0]?.['.id'];
    if (!id) throw new RouterOsApiError(`PPP secret no encontrado: ${name}`);
    await client.execute('/ppp/secret/set', { '.id': id, disabled: 'yes' });
    return;
  }

  if (command.includes('/ppp secret enable')) {
    const name = findNameFromCommand(command, 'name');
    if (!name) throw new RouterOsApiError('No se pudo parsear name en comando PPP');
    const rows = await client.execute('/ppp/secret/print', {}, [`?name=${name}`]);
    const id = rows[0]?.['.id'];
    if (!id) throw new RouterOsApiError(`PPP secret no encontrado: ${name}`);
    await client.execute('/ppp/secret/set', { '.id': id, disabled: 'no' });
    return;
  }

  // Firewall address-list
  if (command.includes('/ip firewall address-list add')) {
    const list = findListFromCommand(command);
    const address = findAddressFromCommand(command);
    const comment = findCommentFromCommand(command) ?? '';
    if (!list || !address) throw new RouterOsApiError('address-list add incompleto');
    await client.execute('/ip/firewall/address-list/add', {
      list,
      address,
      comment,
    });
    return;
  }

  if (command.includes('/ip firewall address-list remove')) {
    const list = findListFromCommand(command);
    const comment = findCommentFromCommand(command);
    const queries: string[] = [];
    if (list) queries.push(`?list=${list}`);
    if (comment) queries.push(`?comment=${comment}`);
    const rows = await client.execute('/ip/firewall/address-list/print', {}, queries);
    for (const row of rows) {
      const id = row['.id'];
      if (id) await client.execute('/ip/firewall/address-list/remove', { '.id': id });
    }
    return;
  }

  // Queue simple disable/enable
  if (command.includes('/queue simple disable') || command.includes('/queue simple enable')) {
    const name = findNameFromCommand(command, 'name~');
    const disabled = command.includes('disable') ? 'yes' : 'no';
    const rows = await client.execute('/queue/simple/print', {}, name ? [`?name~${name}`] : []);
    if (rows.length === 0) {
      logger.warn('Worker commit: queue no encontrada', { name });
      return;
    }
    for (const row of rows) {
      const id = row['.id'];
      if (id) await client.execute('/queue/simple/set', { '.id': id, disabled });
    }
    return;
  }

  throw new RouterOsApiError(`Comando no soportado en commit: ${command}`);
}

export interface CommandExecutionResult {
  ok: boolean;
  executed: number;
  errors: string[];
}

export async function executePlannedCommands(
  router: MikrotikRouterRegistryItem,
  commands: string[],
): Promise<CommandExecutionResult> {
  if (!productionGates.mikrotikWorkerCommit()) {
    return { ok: false, executed: 0, errors: ['MIKROTIK_WORKER_COMMIT deshabilitado'] };
  }
  if (!productionGates.mikrotikWorkerLive()) {
    return { ok: false, executed: 0, errors: ['MIKROTIK_WORKER_LIVE requerido para commit'] };
  }

  let client: RouterOsApiClient | null = null;
  const errors: string[] = [];
  let executed = 0;

  try {
    client = await connectClient(router);
    for (const command of commands) {
      try {
        await executeOne(client, command);
        executed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(redactString(`${command}: ${msg}`));
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(redactString(msg));
  } finally {
    client?.disconnect();
  }

  return { ok: errors.length === 0, executed, errors };
}
