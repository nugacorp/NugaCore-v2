import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  PROVIDER_FLAG,
  resolveProvider,
} from '../../backend/domains/routeros-readonly/providers';
import { routerOsMockProvider } from '../../backend/domains/routeros-readonly/providers/mock-provider';
import {
  createRouterOsProvider,
  READ_ONLY_COMMANDS,
  RouterOsReadError,
} from '../../backend/domains/routeros-readonly/providers/routeros-provider';
import { ROUTEROS_ENV } from '../../backend/domains/routeros-readonly/providers/routeros-client';
import type {
  RouterOsApiRow,
  RouterOsReadOnlyClient,
} from '../../backend/domains/routeros-readonly/providers/provider-interface';
import { createRouterOsReadOnlyService } from '../../backend/domains/routeros-readonly/service';
import { logger } from '../../backend/common/logger';

// ====================================================================
// PROD-5 — Integración del provider RouterOS read-only con el wiring por env,
// el fallback seguro a mock y los logs de evento (sin secretos). No hay CHR
// real: los clientes RouterOS son fakes en memoria.
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
  [READ_ONLY_COMMANDS.wireguardInterfaces]: [{ name: 'wg', 'listen-port': '13231', running: 'true', mtu: '1420' }],
  [READ_ONLY_COMMANDS.wireguardPeers]: [
    { interface: 'wg', 'allowed-address': '10.0.0.2/32', endpoint: 'x:1', 'last-handshake': '1s', rx: '1', tx: '2', disabled: 'false' },
  ],
};

const passingClient: RouterOsReadOnlyClient = {
  print: async (command) => CANNED[command] ?? [],
};

const failingClient = (code: string): RouterOsReadOnlyClient => ({
  print: async () => {
    throw new RouterOsReadError('fallo simulado', code);
  },
});

const slowClient = (delayMs: number): RouterOsReadOnlyClient => ({
  print: () => new Promise((resolve) => setTimeout(() => resolve([{ name: 'late' }]), delayMs)),
});

const ENV_WITH_CREDS = {
  [PROVIDER_FLAG]: 'routeros',
  [ROUTEROS_ENV.host]: '127.0.0.1',
  [ROUTEROS_ENV.username]: 'lab-readonly',
  [ROUTEROS_ENV.password]: 'placeholder-not-a-secret',
} as NodeJS.ProcessEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveProvider — wiring por entorno (PROD-5)', () => {
  it('flag mock (default) → provider mock', () => {
    expect(resolveProvider({} as NodeJS.ProcessEnv).source).toBe('mock');
  });

  it('flag routeros SIN credenciales → provider routeros con cliente no configurado (cae a mock en service)', async () => {
    const provider = resolveProvider({ [PROVIDER_FLAG]: 'routeros' } as NodeJS.ProcessEnv);
    expect(provider.source).toBe('routeros');
    // En el service, sin credenciales el cliente falla y cae a mock.
    const service = createRouterOsReadOnlyService(provider, routerOsMockProvider);
    expect((await service.getIdentity()).source).toBe('mock');
  });

  it('flag routeros CON credenciales → provider routeros con cliente real (source routeros)', () => {
    const provider = resolveProvider(ENV_WITH_CREDS);
    expect(provider.source).toBe('routeros');
  });
});

describe('service real → fallback seguro a mock', () => {
  it('source=routeros cuando el CHR (fake) responde', async () => {
    const service = createRouterOsReadOnlyService(createRouterOsProvider(passingClient), routerOsMockProvider);
    expect((await service.getIdentity()).source).toBe('routeros');
    expect((await service.getSystem()).source).toBe('routeros');
    expect((await service.getWireguard()).source).toBe('routeros');
  });

  it('auth error → source=mock (API nunca rompe)', async () => {
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(failingClient('ROUTEROS_AUTH')),
      routerOsMockProvider,
    );
    expect((await service.getIdentity()).source).toBe('mock');
  });

  it('host inalcanzable → source=mock', async () => {
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(failingClient('EHOSTUNREACH')),
      routerOsMockProvider,
    );
    expect((await service.getSystem()).source).toBe('mock');
  });

  it('timeout → source=mock', async () => {
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(slowClient(80), { timeoutMs: 10 }),
      routerOsMockProvider,
    );
    expect((await service.getIdentity()).source).toBe('mock');
  });
});

describe('logs de evento seguros (sin secretos)', () => {
  it('emite routeros_read_success en lectura real OK', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    const service = createRouterOsReadOnlyService(createRouterOsProvider(passingClient), routerOsMockProvider);
    await service.getIdentity();

    const events = infoSpy.mock.calls.map((call) => (call[1] as { event?: string } | undefined)?.event);
    expect(events).toContain('routeros_read_success');
    // El meta del log no incluye secretos.
    for (const call of infoSpy.mock.calls) {
      const meta = JSON.stringify(call[1] ?? {});
      expect(meta).not.toContain('placeholder-not-a-secret');
      expect(meta.toLowerCase()).not.toContain('password');
    }
  });

  it('emite routeros_read_fallback cuando cae a mock', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const service = createRouterOsReadOnlyService(
      createRouterOsProvider(failingClient('ROUTEROS_AUTH')),
      routerOsMockProvider,
    );
    await service.getIdentity();

    const events = warnSpy.mock.calls.map((call) => (call[1] as { event?: string } | undefined)?.event);
    expect(events).toContain('routeros_read_fallback');
    for (const call of warnSpy.mock.calls) {
      const meta = JSON.stringify(call[1] ?? {});
      expect(meta.toLowerCase()).not.toContain('password');
    }
  });
});
