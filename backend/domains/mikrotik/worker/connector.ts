// ====================================================================
// RouterConnector (Fase 4.6) — lecturas RouterOS de SOLO LECTURA.
//
//   - Simulado por defecto (sin red), reutiliza salidas tipo "print".
//   - Real (read-only) cuando MIKROTIK_WORKER_LIVE=true y el router tiene
//     credenciales: usa routeros-client. Cualquier fallo → fallback simulado.
//
// Allowlist estricta: solo comandos de lectura "print". Nada destructivo.
// ====================================================================

import { decryptSecret } from '../../../services/crypto';
import { logger } from '../../../common/logger';
import { redactString } from '../../../common/secret-redaction';
import { MikrotikRouterRegistryItem } from '../../../state/store';
import { routerOsRead } from './routeros-client';
import {
  READ_ONLY_COMMANDS,
  ReadOnlyCommand,
  RouterReadResult,
  RouterSnapshot,
  WorkerMode,
} from './types';

export const isLiveWorkerEnabled = (): boolean =>
  (process.env.MIKROTIK_WORKER_LIVE || 'false').trim().toLowerCase() === 'true';

const isReadOnly = (command: string): command is ReadOnlyCommand =>
  (READ_ONLY_COMMANDS as readonly string[]).includes(command);

// ── Salida simulada por comando ───────────────────────────────────────
const simulate = (command: string, router: MikrotikRouterRegistryItem): string => {
  switch (command) {
    case '/system/resource/print':
      return `uptime: 12d 4h\nversion: ${router.routerOsVersion}\ncpu-load: 7%\nfree-memory: 512MiB\ntotal-memory: 1024MiB`;
    case '/interface/print':
      return `0 R ether1-WAN  ether  1500\n1 R ether2-LAN  ether  1500\n2 R ${router.connectionType === 'wireguard' ? 'NugaCoreWG wg' : 'NugaCoreVPN sstp'}  1420`;
    case '/queue/simple/print':
      return `0  D sofia_rodriguez_nuga   target=10.100.10.12  max-limit=50M/50M\n1  D school_benito_juarez    target=10.100.10.88  max-limit=20M/20M`;
    case '/ppp/secret/print':
      return `0 name=sofia_rodriguez_nuga service=pppoe profile=default\n1 name=school_benito_juarez service=pppoe profile=default`;
    case '/ppp/active/print':
      return `0 name=sofia_rodriguez_nuga address=10.100.10.12 uptime=05:42:19\n1 name=school_benito_juarez address=10.100.10.88 uptime=22:11:05`;
    case '/ip/address/print':
      return `0 ${router.managementIp || router.ipAddress}/24 ${router.connectionType || 'sstp'}`;
    default:
      return `[simulated] ${command}`;
  }
};

const resolveHost = (router: MikrotikRouterRegistryItem): string =>
  router.vpnIp || router.managementIp || router.ipAddress;

export interface RouterConnector {
  read(router: MikrotikRouterRegistryItem, command: string): Promise<RouterReadResult>;
  snapshot(router: MikrotikRouterRegistryItem): Promise<RouterSnapshot>;
}

export class DefaultRouterConnector implements RouterConnector {
  async read(router: MikrotikRouterRegistryItem, command: string): Promise<RouterReadResult> {
    if (!isReadOnly(command)) {
      return { command, ok: false, source: 'simulated', data: '', error: 'Command not allowed (read-only only).' };
    }

    const canLive = isLiveWorkerEnabled() && !!router.encryptedPassword;
    if (canLive) {
      try {
        const password = decryptSecret(router.encryptedPassword);
        const rows = await routerOsRead(command, {
          host: resolveHost(router),
          port: router.apiPort,
          username: router.username,
          password,
        });
        return { command, ok: true, source: 'live', data: JSON.stringify(rows) };
      } catch (err) {
        // Fallback simulado. Nunca logueamos el password (redactado por si acaso).
        logger.warn('Worker: lectura live falló, usando simulado', {
          routerId: router.id,
          command,
          error: redactString(err instanceof Error ? err.message : 'unknown'),
        });
        return { command, ok: true, source: 'simulated', data: simulate(command, router), error: 'live_failed_fallback_simulated' };
      }
    }

    return { command, ok: true, source: 'simulated', data: simulate(command, router) };
  }

  async snapshot(router: MikrotikRouterRegistryItem): Promise<RouterSnapshot> {
    const reads: RouterReadResult[] = [];
    for (const cmd of READ_ONLY_COMMANDS) {
      reads.push(await this.read(router, cmd));
    }
    const source: WorkerMode = reads.some((r) => r.source === 'live') ? 'live' : 'simulated';
    return {
      routerId: router.id,
      routerName: router.name,
      generatedAt: new Date().toISOString(),
      source,
      reads,
    };
  }
}

let singleton: RouterConnector | null = null;
export const getRouterConnector = (): RouterConnector => {
  if (!singleton) singleton = new DefaultRouterConnector();
  return singleton;
};

/** Solo para tests: inyecta un conector mock y devuelve una función de cleanup. */
export const setTestRouterConnector = (c: RouterConnector): void => { singleton = c; };
export const resetTestRouterConnector = (): void => { singleton = null; };
