import { createHash } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RouterOsApiClient,
  RouterOsApiError,
  decodeLength,
  encodeLength,
  resolveRouterApiEndpoint,
  routerOsRead,
} from '../../backend/domains/mikrotik/worker/routeros-client';

function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const word of words) {
    const body = Buffer.from(word, 'utf8');
    parts.push(encodeLength(body.length), body);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

type MockHandler = (words: string[]) => Buffer[];

const startMockRouterOsApi = (
  handler: MockHandler,
): Promise<{ port: number; close: () => Promise<void> }> =>
  new Promise((resolve, reject) => {
    const server: Server = createServer((socket: Socket) => {
      const parserWords: string[] = [];
      let buf = Buffer.alloc(0);

      const flushSentence = () => {
        if (parserWords.length === 0) return;
        const sentence = [...parserWords];
        parserWords.length = 0;
        for (const response of handler(sentence)) {
          socket.write(response);
        }
      };

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length > 0) {
          const decoded = decodeLength(buf, 0);
          if (!decoded) break;
          const { length, bytesConsumed: header } = decoded;
          if (buf.length < header + length) break;
          const word =
            length === 0 ? '' : buf.subarray(header, header + length).toString('utf8');
          buf = buf.subarray(header + length);
          if (word === '') flushSentence();
          else parserWords.push(word);
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });

let mockServers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(mockServers.map((close) => close()));
  mockServers = [];
});

describe('RouterOS protocol encoding', () => {
  it('encodeLength y decodeLength son inversos para rangos típicos', () => {
    for (const len of [0, 1, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff]) {
      const encoded = encodeLength(len);
      const decoded = decodeLength(encoded, 0);
      expect(decoded?.length).toBe(len);
    }
  });
});

describe('resolveRouterApiEndpoint', () => {
  it('usa api-ssl cuando MIKROTIK_WORKER_API_TLS y apiSslPort están presentes', () => {
    expect(
      resolveRouterApiEndpoint({ apiPort: 8728, apiSslPort: 8729, preferTls: true }),
    ).toEqual({ port: 8729, useTls: true });
  });

  it('detecta TLS automáticamente en puerto 8729', () => {
    expect(resolveRouterApiEndpoint({ apiPort: 8729 })).toEqual({
      port: 8729,
      useTls: true,
    });
  });

  it('usa API plana por defecto', () => {
    expect(resolveRouterApiEndpoint({ apiPort: 8728 })).toEqual({
      port: 8728,
      useTls: false,
    });
  });
});

describe('RouterOsApiClient — login moderno y lectura', () => {
  it('autentica y ejecuta un print devolviendo filas !re', async () => {
    const mock = await startMockRouterOsApi((words) => {
      if (words[0] === '/login') {
        return [encodeSentence(['!done'])];
      }
      if (words[0] === '/system/resource/print') {
        return [
          encodeSentence(['!re', '=version=7.12', '=cpu-load=5']),
          encodeSentence(['!done']),
        ];
      }
      return [encodeSentence(['!trap', '=message=unknown'])];
    });
    mockServers.push(mock.close);

    const client = new RouterOsApiClient({
      host: '127.0.0.1',
      port: mock.port,
      username: 'nugacore',
      password: 'placeholder-not-a-secret',
      connectTimeoutMs: 2000,
      readTimeoutMs: 2000,
    });

    await client.connect();
    const rows = await client.execute('/system/resource/print');
    client.disconnect();

    expect(rows).toEqual([{ version: '7.12', 'cpu-load': '5' }]);
  });

  it('routerOsRead cierra la conexión tras una lectura', async () => {
    const mock = await startMockRouterOsApi((words) => {
      if (words[0] === '/login') return [encodeSentence(['!done'])];
      return [
        encodeSentence(['!re', '=name=ether1']),
        encodeSentence(['!done']),
      ];
    });
    mockServers.push(mock.close);

    const rows = await routerOsRead('/interface/print', {
      host: '127.0.0.1',
      port: mock.port,
      username: 'lab',
      password: 'x',
      timeoutMs: 2000,
    });

    expect(rows).toEqual([{ name: 'ether1' }]);
  });
});

describe('RouterOsApiClient — login legacy MD5', () => {
  it('completa challenge-response y ejecuta comando', async () => {
    const challenge = Buffer.from('aabbccdd', 'hex');
    const md5 = createHash('md5');
    md5.update(Buffer.from([0x00]));
    md5.update(Buffer.from('legacy-pass', 'utf8'));
    md5.update(challenge);
    const responseHex = `00${md5.digest('hex')}`;

    const mock = await startMockRouterOsApi((words) => {
      if (words[0] === '/login' && words.some((w) => w.startsWith('=password='))) {
        return [encodeSentence(['!re', `=ret=${challenge.toString('hex')}`]), encodeSentence(['!done'])];
      }
      if (words[0] === '/login' && words.some((w) => w.startsWith('=response='))) {
        const sent = words.find((w) => w.startsWith('=response='))?.slice(10);
        if (sent === responseHex) return [encodeSentence(['!done'])];
        return [encodeSentence(['!trap', '=message=bad auth'])];
      }
      if (words[0] === '/interface/print') {
        return [encodeSentence(['!re', '=name=wg0']), encodeSentence(['!done'])];
      }
      return [encodeSentence(['!trap', '=message=unexpected'])];
    });
    mockServers.push(mock.close);

    const client = new RouterOsApiClient({
      host: '127.0.0.1',
      port: mock.port,
      username: 'legacy',
      password: 'legacy-pass',
      connectTimeoutMs: 2000,
      readTimeoutMs: 2000,
    });

    await client.connect();
    const rows = await client.execute('/interface/print');
    client.disconnect();
    expect(rows).toEqual([{ name: 'wg0' }]);
  });
});

describe('RouterOsApiClient — traps y cola secuencial', () => {
  it('drena !done tras !trap para no desincronizar el siguiente comando', async () => {
    let commandCount = 0;
    const mock = await startMockRouterOsApi((words) => {
      if (words[0] === '/login') return [encodeSentence(['!done'])];
      commandCount += 1;
      if (commandCount === 1) {
        return [encodeSentence(['!trap', '=message=rejected']), encodeSentence(['!done'])];
      }
      return [encodeSentence(['!re', '=uptime=1d']), encodeSentence(['!done'])];
    });
    mockServers.push(mock.close);

    const client = new RouterOsApiClient({
      host: '127.0.0.1',
      port: mock.port,
      username: 'lab',
      password: 'x',
      connectTimeoutMs: 2000,
      readTimeoutMs: 2000,
    });

    await client.connect();

    await expect(client.execute('/system/reboot')).rejects.toBeInstanceOf(RouterOsApiError);
    const rows = await client.execute('/system/resource/print');
    client.disconnect();

    expect(rows).toEqual([{ uptime: '1d' }]);
    expect(commandCount).toBe(2);
  });

  it('serializa comandos concurrentes vía operationChain', async () => {
    const order: string[] = [];
    const mock = await startMockRouterOsApi((words) => {
      if (words[0] === '/login') return [encodeSentence(['!done'])];
      order.push(words[0]);
      return [encodeSentence(['!re', `=cmd=${words[0]}`]), encodeSentence(['!done'])];
    });
    mockServers.push(mock.close);

    const client = new RouterOsApiClient({
      host: '127.0.0.1',
      port: mock.port,
      username: 'lab',
      password: 'x',
      connectTimeoutMs: 2000,
      readTimeoutMs: 2000,
    });

    await client.connect();
    const [a, b] = await Promise.all([
      client.execute('/interface/print'),
      client.execute('/queue/simple/print'),
    ]);
    client.disconnect();

    expect(order).toEqual(['/interface/print', '/queue/simple/print']);
    expect(a).toEqual([{ cmd: '/interface/print' }]);
    expect(b).toEqual([{ cmd: '/queue/simple/print' }]);
  });
});

describe('RouterOsApiClient — streaming con /cancel', () => {
  it('recoge filas !re hasta timeout y envía /cancel', async () => {
    let cancelSeen = false;
    const mock = await startMockRouterOsApi((words) => {
      if (words[0] === '/login') return [encodeSentence(['!done'])];
      if (words[0] === '/cancel') {
        cancelSeen = true;
        return [encodeSentence(['!done'])];
      }
      if (words[0] === '/tool/ip-scan') {
        return [
          encodeSentence(['!re', '=address=10.0.0.1']),
          encodeSentence(['!re', '=address=10.0.0.2']),
        ];
      }
      return [encodeSentence(['!done'])];
    });
    mockServers.push(mock.close);

    const client = new RouterOsApiClient({
      host: '127.0.0.1',
      port: mock.port,
      username: 'lab',
      password: 'x',
      connectTimeoutMs: 2000,
      readTimeoutMs: 200,
    });

    await client.connect();
    const rows = await client.executeStreaming('/tool/ip-scan', { address: '10.0.0.0/24' }, 250);
    client.disconnect();

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(cancelSeen).toBe(true);
  });
});
