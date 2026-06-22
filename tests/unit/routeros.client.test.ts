import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  ROUTEROS_ENV,
  DEFAULT_ROUTEROS_PORT,
  DEFAULT_ROUTEROS_TIMEOUT_MS,
  commandToRestPath,
  readRouterOsConfigFromEnv,
  createRouterOsClient,
  createRouterOsClientFromEnv,
} from '../../backend/domains/routeros-readonly/providers/routeros-client';
import {
  READ_ONLY_COMMANDS,
  RouterOsReadError,
} from '../../backend/domains/routeros-readonly/providers/routeros-provider';

// ====================================================================
// PROD-5 — Cliente RouterOS real (READ-ONLY). Sin credenciales reales, sin
// CHR real: se valida configuración por env, allowlist→ruta REST, mapeo de
// errores de red (loopback) y la garantía estática de no-escritura.
//
// NOTA: los valores de prueba (host/usuario/pass) son PLACEHOLDERS obvios, no
// credenciales reales (la consigna prohíbe credenciales reales en tests).
// ====================================================================

const FAKE_ENV = {
  [ROUTEROS_ENV.host]: '127.0.0.1',
  [ROUTEROS_ENV.username]: 'lab-readonly',
  [ROUTEROS_ENV.password]: 'placeholder-not-a-secret',
} as NodeJS.ProcessEnv;

describe('readRouterOsConfigFromEnv', () => {
  it('devuelve null si faltan host/usuario/password (→ fallback a mock)', () => {
    expect(readRouterOsConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(readRouterOsConfigFromEnv({ [ROUTEROS_ENV.host]: '127.0.0.1' } as NodeJS.ProcessEnv)).toBeNull();
    expect(
      readRouterOsConfigFromEnv({
        [ROUTEROS_ENV.host]: '127.0.0.1',
        [ROUTEROS_ENV.username]: 'lab',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('aplica defaults de puerto/timeout/tls cuando solo hay credenciales', () => {
    const config = readRouterOsConfigFromEnv(FAKE_ENV);
    expect(config).not.toBeNull();
    expect(config!.port).toBe(DEFAULT_ROUTEROS_PORT);
    expect(config!.timeoutMs).toBe(DEFAULT_ROUTEROS_TIMEOUT_MS);
    // CHR de lab: self-signed aceptado por defecto.
    expect(config!.rejectUnauthorized).toBe(false);
  });

  it('respeta port/timeout/tls explícitos', () => {
    const config = readRouterOsConfigFromEnv({
      ...FAKE_ENV,
      [ROUTEROS_ENV.port]: '8443',
      [ROUTEROS_ENV.timeoutMs]: '1500',
      [ROUTEROS_ENV.tlsRejectUnauthorized]: 'true',
    } as NodeJS.ProcessEnv);
    expect(config!.port).toBe(8443);
    expect(config!.timeoutMs).toBe(1500);
    expect(config!.rejectUnauthorized).toBe(true);
  });

  it('createRouterOsClientFromEnv devuelve null sin configuración', () => {
    expect(createRouterOsClientFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(createRouterOsClientFromEnv(FAKE_ENV)).not.toBeNull();
  });
});

describe('commandToRestPath — solo allowlist read-only', () => {
  it('mapea cada comando print de la allowlist a su ruta REST de lectura', () => {
    expect(commandToRestPath(READ_ONLY_COMMANDS.identity)).toBe('/rest/system/identity');
    expect(commandToRestPath(READ_ONLY_COMMANDS.resource)).toBe('/rest/system/resource');
    expect(commandToRestPath(READ_ONLY_COMMANDS.interfaces)).toBe('/rest/interface');
    expect(commandToRestPath(READ_ONLY_COMMANDS.routes)).toBe('/rest/ip/route');
    expect(commandToRestPath(READ_ONLY_COMMANDS.wireguardInterfaces)).toBe('/rest/interface/wireguard');
    expect(commandToRestPath(READ_ONLY_COMMANDS.wireguardPeers)).toBe('/rest/interface/wireguard/peers');
  });

  it('devuelve null para comandos fuera de la allowlist', () => {
    for (const command of [
      '/system/reboot',
      '/ip/firewall/filter/add',
      '/interface/wireguard/peers/add',
      '/system/identity/set',
      '/ip/route/print/../add',
    ]) {
      expect(commandToRestPath(command)).toBeNull();
    }
  });
});

describe('client.print — rechaza comandos no permitidos ANTES de tocar la red', () => {
  it('lanza ROUTEROS_COMMAND_NOT_ALLOWED para comandos de escritura', async () => {
    // Host no enrutable: si intentara conectar, fallaría distinto. Debe rechazar
    // por allowlist sin abrir conexión.
    const client = createRouterOsClient({
      host: '192.0.2.1',
      port: 443,
      username: 'lab',
      password: 'x',
      timeoutMs: 50,
      rejectUnauthorized: false,
    });
    for (const command of ['/system/reboot', '/ip/firewall/filter/add', '/interface/wireguard/peers/add']) {
      await expect(client.print(command)).rejects.toMatchObject({
        code: 'ROUTEROS_COMMAND_NOT_ALLOWED',
      });
    }
  });
});

describe('client.print — error de red mapeado a RouterOsReadError (loopback cerrado)', () => {
  it('rechaza con RouterOsReadError cuando el puerto está cerrado (ECONNREFUSED)', async () => {
    // Reservamos un puerto libre y lo cerramos: la conexión será rechazada de
    // forma determinista, sin red externa.
    const closedPort = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        probe.close(() => resolve(port));
      });
    });

    const client = createRouterOsClient({
      host: '127.0.0.1',
      port: closedPort,
      username: 'lab',
      password: 'x',
      timeoutMs: 1000,
      rejectUnauthorized: false,
    });

    await expect(client.print(READ_ONLY_COMMANDS.identity)).rejects.toBeInstanceOf(RouterOsReadError);
  });
});

describe('static safety — el cliente no contiene verbos de escritura RouterOS', () => {
  const clientSource = readFileSync(
    'backend/domains/routeros-readonly/providers/routeros-client.ts',
    'utf8',
  );

  it('no contiene APIs/verbos de escritura ni comandos peligrosos', () => {
    for (const forbidden of [
      '.add(',
      '.set(',
      '.remove(',
      '.execute(',
      '/ip firewall add',
      '/ip route add',
      '/queue simple add',
      '/ppp secret add',
    ]) {
      expect(clientSource, `prohibido en routeros-client: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('solo usa el método HTTP GET', () => {
    expect(clientSource).toContain("method: 'GET'");
    for (const method of ["method: 'POST'", "method: 'PUT'", "method: 'PATCH'", "method: 'DELETE'"]) {
      expect(clientSource).not.toContain(method);
    }
  });

  it('no emite logs (no puede filtrar secretos): no usa logger ni console', () => {
    // El cliente no importa ni usa el logger ni console: imposible filtrar
    // password/token/credentials por logs desde aquí. El logging seguro
    // (routeros_read_success / routeros_read_fallback) vive en fallback.ts.
    expect(clientSource).not.toContain('console.');
    expect(clientSource).not.toContain('logger');
  });
});
