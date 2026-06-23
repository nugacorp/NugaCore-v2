import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { routerOsMockProvider } from '../../backend/domains/routeros-readonly/providers/mock-provider';
import {
  createRouterOsProvider,
  READ_ONLY_COMMANDS,
  RouterOsReadError,
} from '../../backend/domains/routeros-readonly/providers/routeros-provider';
import { createRouterOsClient } from '../../backend/domains/routeros-readonly/providers/routeros-client';
import type {
  RouterOsApiRow,
  RouterOsReadOnlyClient,
} from '../../backend/domains/routeros-readonly/providers/provider-interface';
import { createRouterOsReadOnlyService } from '../../backend/domains/routeros-readonly/service';

// ====================================================================
// PROD-5.1 — Validación controlada del provider RouterOS read-only contra un
// CHR de laboratorio. Sin CHR físico en este entorno: el CHR se EMULA a nivel
// de cliente (filas crudas estilo `print`) para validar el camino real
// provider → service → mappers (source=routeros); el FALLBACK se valida con un
// socket REAL cerrado (conexión rechazada). Todo hermético, sin red externa.
//
// La observación final contra el CHR de lab real (credenciales fuera del repo)
// la ejecuta Hermes con el runbook de docs/PROD51_CHR_LAB_VALIDATION_RESULT.md.
// ====================================================================

// Filas crudas que devolvería un CHR de lab por `print` (valores distintos del
// mock para poder distinguir el origen). Sin claves privadas ni preshared keys.
const CHR_LAB_ROWS: Record<string, RouterOsApiRow[]> = {
  [READ_ONLY_COMMANDS.identity]: [{ name: 'chr-lab-edge-real' }],
  [READ_ONLY_COMMANDS.resource]: [
    {
      version: '7.15.2 (stable)',
      uptime: '5d1h',
      'cpu-load': '4',
      'total-memory': '268435456',
      'free-memory': '200000000',
      'board-name': 'CHR',
      'architecture-name': 'x86_64',
    },
  ],
  [READ_ONLY_COMMANDS.interfaces]: [
    { name: 'ether-chr-lab', type: 'ether', running: 'true', disabled: 'false', mtu: '1500', 'rx-byte': '1', 'tx-byte': '2' },
  ],
  [READ_ONLY_COMMANDS.routes]: [
    { 'dst-address': '0.0.0.0/0', gateway: '203.0.113.1', distance: '1', active: 'true', 'routing-table': 'main' },
  ],
  [READ_ONLY_COMMANDS.wireguardInterfaces]: [{ name: 'wg-chr', 'listen-port': '13231', running: 'true', mtu: '1420' }],
  [READ_ONLY_COMMANDS.wireguardPeers]: [
    { interface: 'wg-chr', 'allowed-address': '10.66.0.2/32', endpoint: '198.51.100.9:13231', 'last-handshake': '1s', rx: '1', tx: '2', disabled: 'false' },
  ],
};

const chrLabClient: RouterOsReadOnlyClient = {
  print: async (command) => CHR_LAB_ROWS[command] ?? [],
};

const failing = (code: string): RouterOsReadOnlyClient => ({
  print: async () => {
    throw new RouterOsReadError('fallo simulado', code);
  },
});

const slow = (delayMs: number): RouterOsReadOnlyClient => ({
  print: () => new Promise((resolve) => setTimeout(() => resolve([{ name: 'late' }]), delayMs)),
});

/** Reserva un puerto libre de loopback y lo cierra → conexión rechazada determinista. */
const reserveClosedPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });

describe('PROD-5.1 — FASE D: lectura real (CHR emulado) → source=routeros', () => {
  const service = createRouterOsReadOnlyService(createRouterOsProvider(chrLabClient), routerOsMockProvider);

  it('identity reporta source=routeros con datos del CHR', async () => {
    const identity = await service.getIdentity();
    expect(identity.source).toBe('routeros');
    expect(identity.name).toBe('chr-lab-edge-real');
    expect(identity.readOnly).toBe(true);
  });

  it('system reporta source=routeros con recursos del CHR', async () => {
    const system = await service.getSystem();
    expect(system.source).toBe('routeros');
    expect(system.routerosVersion).toContain('7.15.2');
  });

  it('interfaces provienen del CHR (no del mock)', async () => {
    const interfaces = await service.getInterfaces();
    expect(interfaces[0].name).toBe('ether-chr-lab');
  });

  it('routes provienen del CHR (no del mock)', async () => {
    const routes = await service.getRoutes();
    expect(routes[0].gateway).toBe('203.0.113.1');
  });

  it('wireguard reporta source=routeros con interfaces/peers del CHR', async () => {
    const wg = await service.getWireguard();
    expect(wg.source).toBe('routeros');
    expect(wg.interfaces[0].name).toBe('wg-chr');
    expect(wg.peers[0].allowedAddress).toBe('10.66.0.2/32');
  });
});

describe('PROD-5.1 — FASE E: fallback seguro → source=mock (API nunca rompe)', () => {
  it('socket REAL cerrado (host inalcanzable) → source=mock', async () => {
    const closedPort = await reserveClosedPort();
    const realClient = createRouterOsClient({
      host: '127.0.0.1',
      port: closedPort,
      username: 'lab-readonly',
      password: 'placeholder-not-a-secret',
      timeoutMs: 1000,
      rejectUnauthorized: false,
    });
    const service = createRouterOsReadOnlyService(createRouterOsProvider(realClient), routerOsMockProvider);
    const identity = await service.getIdentity();
    expect(identity.source).toBe('mock');
    expect(identity.name).toBeTruthy();
  });

  it('auth failure → source=mock', async () => {
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(failing('ROUTEROS_AUTH')),
      routerOsMockProvider,
    );
    expect((await service.getSystem()).source).toBe('mock');
  });

  it('timeout → source=mock', async () => {
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(slow(80), { timeoutMs: 10 }),
      routerOsMockProvider,
    );
    expect((await service.getIdentity()).source).toBe('mock');
  });
});

describe('PROD-5.1 — FASE A: allowlist read-only estricta', () => {
  const realClient = createRouterOsClient({
    host: '192.0.2.1',
    port: 443,
    username: 'lab',
    password: 'x',
    timeoutMs: 50,
    rejectUnauthorized: false,
  });

  it('solo permite los 5 comandos print de lectura', () => {
    expect(Object.values(READ_ONLY_COMMANDS)).toEqual(
      expect.arrayContaining([
        '/system/identity/print',
        '/system/resource/print',
        '/interface/print',
        '/ip/route/print',
        '/interface/wireguard/print',
      ]),
    );
  });

  it('rechaza comandos de escritura ANTES de tocar la red', async () => {
    for (const command of [
      '/system/reboot',
      '/ip/firewall/filter/add',
      '/interface/wireguard/peers/add',
      '/system/identity/set',
    ]) {
      await expect(realClient.print(command)).rejects.toMatchObject({ code: 'ROUTEROS_COMMAND_NOT_ALLOWED' });
    }
  });
});

describe('PROD-5.1 — FASE H: las respuestas no exponen secretos', () => {
  const service = createRouterOsReadOnlyService(createRouterOsProvider(chrLabClient), routerOsMockProvider);

  it('identity/system/wireguard sin password/private/preshared keys', async () => {
    const payloads = [await service.getIdentity(), await service.getSystem(), await service.getWireguard()];
    for (const payload of payloads) {
      const serialized = JSON.stringify(payload).toLowerCase();
      for (const forbidden of ['password', 'privatekey', 'private key', 'presharedkey', 'preshared key', 'token', 'jwt']) {
        expect(serialized, `no debe exponer ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
