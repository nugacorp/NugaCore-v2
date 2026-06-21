import { describe, expect, it } from 'vitest';
import {
  PROVIDER_FLAG,
  readWithFallback,
  resolveProvider,
  resolveProviderName,
} from '../../backend/domains/routeros-readonly/providers';
import { routerOsMockProvider } from '../../backend/domains/routeros-readonly/providers/mock-provider';
import {
  createRouterOsProvider,
  createUnconfiguredClient,
  READ_ONLY_COMMANDS,
  RouterOsReadError,
} from '../../backend/domains/routeros-readonly/providers/routeros-provider';
import type {
  RouterOsApiRow,
  RouterOsReadOnlyClient,
} from '../../backend/domains/routeros-readonly/providers/provider-interface';
import { createRouterOsReadOnlyService } from '../../backend/domains/routeros-readonly/service';

// ====================================================================
// PROD-4 RouterOS Read-Only — abstracción de providers, feature flag y
// fallback seguro. Sin conexión real: los clientes RouterOS son fakes en
// memoria. Cubre source=mock, source=routeros y fallback a mock.
// ====================================================================

const CANNED: Record<string, RouterOsApiRow[]> = {
  [READ_ONLY_COMMANDS.identity]: [{ name: 'chr-lab-real' }],
  [READ_ONLY_COMMANDS.resource]: [
    {
      version: '7.15.0 (stable)',
      uptime: '1d2h',
      'cpu-load': '3',
      'total-memory': '134217728',
      'free-memory': '100000000',
      'board-name': 'CHR',
      'architecture-name': 'x86_64',
    },
  ],
  [READ_ONLY_COMMANDS.interfaces]: [
    { name: 'ether1', type: 'ether', running: 'true', disabled: 'false', mtu: '1500', 'rx-byte': '10', 'tx-byte': '5' },
  ],
  [READ_ONLY_COMMANDS.routes]: [
    { 'dst-address': '0.0.0.0/0', gateway: '1.1.1.1', distance: '1', active: 'true', 'routing-table': 'main' },
  ],
  [READ_ONLY_COMMANDS.wireguardInterfaces]: [
    { name: 'wg', 'listen-port': '13231', running: 'true', mtu: '1420' },
  ],
  [READ_ONLY_COMMANDS.wireguardPeers]: [
    { interface: 'wg', 'allowed-address': '10.0.0.2/32', endpoint: 'x:1', 'last-handshake': '1s', rx: '1', tx: '2', disabled: 'false' },
  ],
};

const passingClient: RouterOsReadOnlyClient = {
  print: async (command) => CANNED[command] ?? [],
};

const makeFailingClient = (code: string): RouterOsReadOnlyClient => ({
  print: async () => {
    throw new RouterOsReadError('fallo simulado', code);
  },
});

describe('feature flag ROUTEROS_READONLY_PROVIDER', () => {
  const envWith = (value?: string): NodeJS.ProcessEnv =>
    (value === undefined ? {} : { [PROVIDER_FLAG]: value }) as NodeJS.ProcessEnv;

  it('default mock cuando la variable no existe', () => {
    expect(resolveProviderName(envWith())).toBe('mock');
    expect(resolveProvider(envWith()).source).toBe('mock');
  });

  it('routeros cuando la variable es routeros (case-insensitive)', () => {
    expect(resolveProviderName(envWith('routeros'))).toBe('routeros');
    expect(resolveProviderName(envWith('RouterOS'))).toBe('routeros');
    expect(resolveProvider(envWith('routeros')).source).toBe('routeros');
  });

  it('valor desconocido cae a mock', () => {
    expect(resolveProviderName(envWith('weird'))).toBe('mock');
    expect(resolveProviderName(envWith('MOCK'))).toBe('mock');
  });
});

describe('mock provider', () => {
  it('cumple la interfaz async y reporta source=mock', async () => {
    expect(routerOsMockProvider.source).toBe('mock');
    expect((await routerOsMockProvider.fetchIdentity()).name).toBeTruthy();
    expect((await routerOsMockProvider.fetchInterfaces()).length).toBeGreaterThan(0);
  });
});

describe('routeros provider (cliente fake, sin red real)', () => {
  it('reporta source=routeros y devuelve filas crudas mapeables', async () => {
    const provider = createRouterOsProvider(passingClient);
    expect(provider.source).toBe('routeros');
    expect((await provider.fetchIdentity()).name).toBe('chr-lab-real');
    expect((await provider.fetchInterfaces())[0].name).toBe('ether1');
    expect((await provider.fetchWireguardPeers())[0]['allowed-address']).toBe('10.0.0.2/32');
  });

  it('solo usa comandos print de la allowlist', async () => {
    const seen: string[] = [];
    const recordingClient: RouterOsReadOnlyClient = {
      print: async (command) => {
        seen.push(command);
        return CANNED[command] ?? [];
      },
    };
    const provider = createRouterOsProvider(recordingClient);
    await provider.fetchIdentity();
    await provider.fetchResource();
    await provider.fetchInterfaces();
    await provider.fetchRoutes();
    await provider.fetchWireguardInterfaces();
    await provider.fetchWireguardPeers();

    const allowed = Object.values(READ_ONLY_COMMANDS);
    for (const command of seen) {
      expect(allowed).toContain(command);
      expect(command.endsWith('/print')).toBe(true);
    }
  });

  it('cliente no configurado falla con código estable', async () => {
    const provider = createRouterOsProvider(createUnconfiguredClient());
    await expect(provider.fetchIdentity()).rejects.toMatchObject({ code: 'ROUTEROS_NOT_CONFIGURED' });
  });

  it('aplica timeout y lanza ROUTEROS_TIMEOUT', async () => {
    const slowClient: RouterOsReadOnlyClient = {
      print: () => new Promise((resolve) => setTimeout(() => resolve([{ name: 'late' }]), 80)),
    };
    const provider = createRouterOsProvider(slowClient, { timeoutMs: 10 });
    await expect(provider.fetchIdentity()).rejects.toMatchObject({ code: 'ROUTEROS_TIMEOUT' });
  });
});

describe('readWithFallback', () => {
  it('cae a mock cuando el primario routeros falla (auth/unreachable/timeout)', async () => {
    for (const code of ['ROUTEROS_AUTH', 'EHOSTUNREACH', 'ROUTEROS_TIMEOUT']) {
      const failing = createRouterOsProvider(makeFailingClient(code));
      const res = await readWithFallback(failing, routerOsMockProvider, (p) => p.fetchIdentity());
      expect(res.source).toBe('mock');
      expect(res.data.name).toBeTruthy();
    }
  });

  it('re-lanza si primario y fallback comparten source', async () => {
    const failing = createRouterOsProvider(makeFailingClient('ROUTEROS_AUTH'));
    await expect(readWithFallback(failing, failing, (p) => p.fetchIdentity())).rejects.toBeTruthy();
  });
});

describe('service con providers inyectados', () => {
  it('source=routeros cuando el provider real responde', async () => {
    const service = createRouterOsReadOnlyService(createRouterOsProvider(passingClient), routerOsMockProvider);
    expect((await service.getIdentity()).source).toBe('routeros');
    expect((await service.getSystem()).source).toBe('routeros');
    expect((await service.getWireguard()).source).toBe('routeros');
  });

  it('fallback a mock (source=mock) cuando el provider real falla', async () => {
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(createUnconfiguredClient()),
      routerOsMockProvider,
    );
    const identity = await service.getIdentity();
    expect(identity.source).toBe('mock');
    expect(identity.name).toBeTruthy();
    const wg = await service.getWireguard();
    expect(wg.source).toBe('mock');
  });
});
