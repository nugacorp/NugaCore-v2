// ====================================================================
// RouterConnector (Fase 4.6) — lecturas RouterOS de SOLO LECTURA.
//
//   - Simulado por defecto (sin red), reutiliza salidas tipo "print".
//   - Real (read-only) cuando MIKROTIK_WORKER_LIVE=true y el router tiene
//     credenciales: usa routeros-client. Cualquier fallo → fallback simulado.
//
// Allowlist estricta: solo comandos de lectura "print". Nada destructivo.
//
// Sesión API: un login por lote (snapshot), no un login por cada `print`.
// Polling periódico (NOC poller) hace ciclos cortos: login → lectura → logout.
// No se mantiene TCP permanente (RouterOS limita sesiones y es más frágil).
// ====================================================================

import { productionGates } from '../../../config/production-gates';
import { decryptSecret } from '../../../services/crypto';
import { logger } from '../../../common/logger';
import { redactString } from '../../../common/secret-redaction';
import { MikrotikRouterRegistryItem } from '../../../state/store';
import { resolveRouterApiEndpoint, routerOsRead, routerOsReadMany } from './routeros-client';
import {
  READ_ONLY_COMMANDS,
  ReadOnlyCommand,
  RouterReadResult,
  RouterSnapshot,
  WorkerMode,
} from './types';

export const isLiveWorkerEnabled = (): boolean => productionGates.mikrotikWorkerLive();

/** Prefiere api-ssl (puerto 8729) cuando el router lo expone. */
export const isWorkerApiTlsPreferred = (): boolean =>
  (process.env.MIKROTIK_WORKER_API_TLS || 'false').trim().toLowerCase() === 'true';

const isReadOnly = (command: string): command is ReadOnlyCommand =>
  (READ_ONLY_COMMANDS as readonly string[]).includes(command);

const resolveHost = (router: MikrotikRouterRegistryItem): string =>
  router.vpnIp || router.managementIp || router.ipAddress;

type LiveEndpoint = {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls: boolean;
};

const resolveLiveEndpoint = (router: MikrotikRouterRegistryItem): LiveEndpoint | null => {
  if (!isLiveWorkerEnabled() || !router.encryptedPassword) return null;
  const password = decryptSecret(router.encryptedPassword);
  const endpoint = resolveRouterApiEndpoint({
    apiPort: router.apiPort,
    apiSslPort: router.apiSslPort,
    preferTls: isWorkerApiTlsPreferred(),
  });
  return {
    host: resolveHost(router),
    port: endpoint.port,
    username: router.username,
    password,
    useTls: endpoint.useTls,
  };
};

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

const simulatedRead = (command: string, router: MikrotikRouterRegistryItem, error?: string): RouterReadResult => ({
  command,
  ok: true,
  source: 'simulated',
  data: simulate(command, router),
  ...(error ? { error } : {}),
});

export interface RouterConnector {
  read(router: MikrotikRouterRegistryItem, command: string): Promise<RouterReadResult>;
  snapshot(router: MikrotikRouterRegistryItem): Promise<RouterSnapshot>;
}

export class DefaultRouterConnector implements RouterConnector {
  async read(router: MikrotikRouterRegistryItem, command: string): Promise<RouterReadResult> {
    if (!isReadOnly(command)) {
      return { command, ok: false, source: 'simulated', data: '', error: 'Command not allowed (read-only only).' };
    }

    const live = resolveLiveEndpoint(router);
    if (live) {
      try {
        const rows = await routerOsRead(command, live);
        return { command, ok: true, source: 'live', data: JSON.stringify(rows) };
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'unknown';
        const safe = redactString(raw);
        logger.warn('Worker: lectura live falló, usando simulado', {
          routerId: router.id,
          command,
          error: safe,
        });
        return simulatedRead(command, router, `live_failed:${safe}`);
      }
    }

    return simulatedRead(command, router);
  }

  /**
   * Un login API → todos los prints allowlisted → un logout.
   * Antes cada `print` abría sesión propia (spam en log del CHR).
   */
  async snapshot(router: MikrotikRouterRegistryItem): Promise<RouterSnapshot> {
    const live = resolveLiveEndpoint(router);

    if (live) {
      try {
        const batches = await routerOsReadMany(READ_ONLY_COMMANDS, live);
        const reads: RouterReadResult[] = READ_ONLY_COMMANDS.map((command, i) => ({
          command,
          ok: true,
          source: 'live' as const,
          data: JSON.stringify(batches[i] ?? []),
        }));
        return {
          routerId: router.id,
          routerName: router.name,
          generatedAt: new Date().toISOString(),
          source: 'live',
          reads,
        };
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'unknown';
        const safe = redactString(raw);
        logger.warn('Worker: snapshot live falló, usando simulado', {
          routerId: router.id,
          error: safe,
        });
        const reads = READ_ONLY_COMMANDS.map((cmd) =>
          simulatedRead(cmd, router, `live_failed:${safe}`),
        );
        return {
          routerId: router.id,
          routerName: router.name,
          generatedAt: new Date().toISOString(),
          source: 'simulated',
          reads,
        };
      }
    }

    const reads = READ_ONLY_COMMANDS.map((cmd) => simulatedRead(cmd, router));
    const source: WorkerMode = 'simulated';
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
