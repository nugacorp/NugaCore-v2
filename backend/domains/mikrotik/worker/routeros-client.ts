// ====================================================================
// Cliente del protocolo API binario de RouterOS (Worker MikroTik).
//
// Implementación propia sobre net.Socket / tls (sin dependencias externas).
// Por diseño del worker solo se usa para comandos de lectura "print"
// (allowlist en el conector). Incluye mejoras inspiradas en patrones NMS:
//   - TLS / api-ssl (puerto 8729, certificados self-signed aceptados)
//   - Cola secuencial de operaciones (sin interleaving de comandos)
//   - Drenaje de !done tras !trap (evita desincronización del stream)
//   - Comandos streaming con /cancel (p. ej. /tool/ip-scan)
//
// SEGURIDAD: el password se recibe ya descifrado en memoria y NUNCA se loguea.
// ====================================================================

import net from 'node:net';
import tls from 'node:tls';
import { createHash } from 'node:crypto';

// ── Codificación de longitud (RouterOS API) ───────────────────────────

export function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const v = len | 0x8000;
    return Buffer.from([(v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x200000) {
    const v = len | 0xc00000;
    return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  if (len < 0x10000000) {
    const v = len | 0xe0000000;
    return Buffer.from([(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }
  return Buffer.from([0xf0, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

export function decodeLength(
  buf: Buffer,
  offset: number,
): { length: number; bytesConsumed: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];

  if (first < 0x80) return { length: first, bytesConsumed: 1 };
  if (first < 0xc0) {
    if (offset + 1 >= buf.length) return null;
    return { length: ((first & 0x3f) << 8) | buf[offset + 1], bytesConsumed: 2 };
  }
  if (first < 0xe0) {
    if (offset + 2 >= buf.length) return null;
    return {
      length: ((first & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2],
      bytesConsumed: 3,
    };
  }
  if (first < 0xf0) {
    if (offset + 3 >= buf.length) return null;
    return {
      length:
        ((first & 0x0f) << 24) |
        (buf[offset + 1] << 16) |
        (buf[offset + 2] << 8) |
        buf[offset + 3],
      bytesConsumed: 4,
    };
  }
  if (offset + 4 >= buf.length) return null;
  return {
    length:
      (buf[offset + 1] << 24) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 8) |
      buf[offset + 4],
    bytesConsumed: 5,
  };
}

const encodeWord = (word: string): Buffer => {
  const body = Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(body.length), body]);
};

const encodeSentence = (words: string[]): Buffer =>
  Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);

// ── Tipos y errores ───────────────────────────────────────────────────

export interface RouterOsSentence {
  type: string;
  words: Record<string, string>;
  tag?: string;
}

export class RouterOsApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'RouterOsApiError';
  }
}

export interface RouterOsClientOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  /** Activa TLS (api-ssl). Por defecto true cuando port === 8729. */
  useTls?: boolean;
  /** Verificación de certificado TLS. Por defecto false (self-signed RouterOS). */
  rejectUnauthorized?: boolean;
}

export interface RouterOsReadOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
  useTls?: boolean;
  rejectUnauthorized?: boolean;
}

const parseSentence = (words: string[]): RouterOsSentence | null => {
  if (words.length === 0) return null;
  const type = words[0];
  const parsed: Record<string, string> = {};
  let tag: string | undefined;
  for (let i = 1; i < words.length; i += 1) {
    const w = words[i];
    if (w.startsWith('=')) {
      const eq = w.indexOf('=', 1);
      if (eq > 0) parsed[w.slice(1, eq)] = w.slice(eq + 1);
    } else if (w.startsWith('.tag=')) {
      tag = w.slice(5);
    }
  }
  return { type, words: parsed, tag };
};

// ── Decodificador incremental de sentencias ───────────────────────────

class SentenceParser {
  private buf = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const sentences: string[][] = [];
    while (true) {
      const parsed = this.readWord();
      if (parsed === null) break;
      if (parsed === '') {
        sentences.push(this.words);
        this.words = [];
      } else {
        this.words.push(parsed);
      }
    }
    return sentences;
  }

  private readWord(): string | null {
    if (this.buf.length === 0) return null;
    const decoded = decodeLength(this.buf, 0);
    if (!decoded) return null;
    const { length, bytesConsumed: header } = decoded;
    if (this.buf.length < header + length) return null;
    const word =
      length === 0
        ? ''
        : this.buf.subarray(header, header + length).toString('utf8');
    this.buf = this.buf.subarray(header + length);
    return word;
  }
}

// ── Cliente con cola secuencial ───────────────────────────────────────

export class RouterOsApiClient {
  private socket: net.Socket | null = null;
  private parser = new SentenceParser();
  private connected = false;
  private authenticated = false;
  private operationChain: Promise<void> = Promise.resolve();
  private pendingRead: {
    resolve: (sentence: RouterOsSentence) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private sentenceQueue: RouterOsSentence[] = [];
  private tagCounter = 0;

  private readonly useTls: boolean;
  private readonly connectTimeoutMs: number;
  private readonly readTimeoutMs: number;
  private readonly rejectUnauthorized: boolean;

  constructor(private readonly opts: RouterOsClientOptions) {
    this.useTls = opts.useTls ?? opts.port === 8729;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 4000;
    this.readTimeoutMs = opts.readTimeoutMs ?? opts.connectTimeoutMs ?? 4000;
    this.rejectUnauthorized = opts.rejectUnauthorized ?? false;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket?.destroy();
        reject(new RouterOsApiError(`Connection timeout to ${this.opts.host}:${this.opts.port}`));
      }, this.connectTimeoutMs);

      const onReady = async () => {
        clearTimeout(timer);
        try {
          await this.authenticate();
          this.connected = true;
          this.authenticated = true;
          resolve();
        } catch (err) {
          this.socket?.destroy();
          reject(err);
        }
      };

      const attachSocket = (socket: net.Socket) => {
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (err) => {
          this.connected = false;
          this.authenticated = false;
          this.rejectPending(new RouterOsApiError(`Socket error: ${err.message}`));
        });
        socket.on('close', () => {
          this.connected = false;
          this.authenticated = false;
          this.rejectPending(new RouterOsApiError('Connection closed'));
        });
      };

      if (this.useTls) {
        const tlsSocket = tls.connect(
          {
            host: this.opts.host,
            port: this.opts.port,
            rejectUnauthorized: this.rejectUnauthorized,
          },
          () => {
            void onReady();
          },
        );
        attachSocket(tlsSocket);
        tlsSocket.on('error', (err) => {
          clearTimeout(timer);
          reject(new RouterOsApiError(`TLS connection failed: ${err.message}`));
        });
      } else {
        const plainSocket = net.createConnection(
          { host: this.opts.host, port: this.opts.port },
          () => {
            void onReady();
          },
        );
        attachSocket(plainSocket);
        plainSocket.on('error', (err) => {
          clearTimeout(timer);
          reject(err instanceof RouterOsApiError ? err : new RouterOsApiError(err.message));
        });
      }
    });
  }

  disconnect(): void {
    this.connected = false;
    this.authenticated = false;
    this.socket?.destroy();
    this.socket = null;
    this.parser = new SentenceParser();
    this.sentenceQueue = [];
    this.rejectPending(new RouterOsApiError('Disconnected'));
  }

  isConnected(): boolean {
    return this.connected && this.authenticated;
  }

  async execute(
    command: string,
    params: Record<string, string> = {},
    queries: string[] = [],
  ): Promise<Record<string, string>[]> {
    let result: Record<string, string>[] = [];
    let error: Error | undefined;

    await new Promise<void>((resolve) => {
      this.operationChain = this.operationChain.then(async () => {
        try {
          result = await this.executeRaw(command, params, queries);
        } catch (err) {
          error = err as Error;
        }
        resolve();
      });
    });

    if (error) throw error;
    return result;
  }

  async executeStreaming(
    command: string,
    params: Record<string, string> = {},
    maxDurationMs = 30_000,
  ): Promise<Record<string, string>[]> {
    let result: Record<string, string>[] = [];
    let error: Error | undefined;

    await new Promise<void>((resolve) => {
      this.operationChain = this.operationChain.then(async () => {
        try {
          result = await this.executeStreamingRaw(command, params, maxDurationMs);
        } catch (err) {
          error = err as Error;
        }
        resolve();
      });
    });

    if (error) throw error;
    return result;
  }

  private async executeRaw(
    command: string,
    params: Record<string, string>,
    queries: string[],
  ): Promise<Record<string, string>[]> {
    if (!this.socket || !this.connected) {
      throw new RouterOsApiError('Not connected');
    }

    const words = [command];
    for (const [key, value] of Object.entries(params)) {
      words.push(`=${key}=${value}`);
    }
    for (const query of queries) {
      words.push(query);
    }

    await this.sendSentence(words);

    const rows: Record<string, string>[] = [];
    while (true) {
      const sentence = await this.readNextSentence();
      if (sentence.type === '!done') break;
      if (sentence.type === '!re') {
        rows.push(sentence.words);
      } else if (sentence.type === '!trap') {
        await this.drainAfterTrap();
        throw new RouterOsApiError(
          sentence.words.message || `Command failed: ${command}`,
          sentence.words.category,
        );
      } else if (sentence.type === '!fatal') {
        this.connected = false;
        throw new RouterOsApiError(sentence.words.message || 'Fatal error received');
      }
    }
    return rows;
  }

  private async executeStreamingRaw(
    command: string,
    params: Record<string, string>,
    maxDurationMs: number,
  ): Promise<Record<string, string>[]> {
    if (!this.socket || !this.connected) {
      throw new RouterOsApiError('Not connected');
    }

    const tag = String(++this.tagCounter);
    const words = [command];
    for (const [key, value] of Object.entries(params)) {
      words.push(`=${key}=${value}`);
    }
    words.push(`.tag=${tag}`);

    await this.sendSentence(words);

    const rows: Record<string, string>[] = [];
    const deadline = Date.now() + maxDurationMs;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      let sentence: RouterOsSentence;
      try {
        sentence = await this.readNextSentence(Math.min(remaining, this.readTimeoutMs));
      } catch {
        break;
      }

      if (sentence.type === '!re') {
        rows.push(sentence.words);
      } else if (sentence.type === '!done') {
        return rows;
      } else if (sentence.type === '!trap') {
        await this.drainAfterTrap();
        throw new RouterOsApiError(
          sentence.words.message || `Streaming command failed: ${command}`,
          sentence.words.category,
        );
      } else if (sentence.type === '!fatal') {
        this.connected = false;
        throw new RouterOsApiError(sentence.words.message || 'Fatal error received');
      }
    }

    try {
      await this.sendSentence(['/cancel', `=tag=${tag}`]);
      for (let i = 0; i < 2; i += 1) {
        const s = await this.readNextSentence(5_000).catch(() => null);
        if (!s || s.type === '!done') break;
      }
    } catch {
      // Ignorar errores de cancelación.
    }

    return rows;
  }

  private async authenticate(): Promise<void> {
    await this.sendSentence([
      '/login',
      `=name=${this.opts.username}`,
      `=password=${this.opts.password}`,
    ]);

    const first = await this.readNextSentence();
    if (first.type === '!done') return;

    if (first.type === '!re' && first.words.ret) {
      await this.readNextSentence();
      const challenge = Buffer.from(first.words.ret, 'hex');
      const md5 = createHash('md5');
      md5.update(Buffer.from([0x00]));
      md5.update(Buffer.from(this.opts.password, 'utf8'));
      md5.update(challenge);
      const responseHex = `00${md5.digest('hex')}`;

      await this.sendSentence([
        '/login',
        `=name=${this.opts.username}`,
        `=response=${responseHex}`,
      ]);

      const result = await this.readNextSentence();
      if (result.type !== '!done') {
        throw new RouterOsApiError(
          result.words.message || 'Authentication failed (legacy MD5)',
          result.words.category,
        );
      }
      return;
    }

    if (first.type === '!trap') {
      throw new RouterOsApiError(
        first.words.message || 'Authentication failed',
        first.words.category,
      );
    }

    throw new RouterOsApiError(`Unexpected login response: ${first.type}`);
  }

  private async drainAfterTrap(): Promise<void> {
    await this.readNextSentence(5_000).catch(() => undefined);
  }

  private sendSentence(words: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new RouterOsApiError('Socket not available'));
        return;
      }
      this.socket.write(encodeSentence(words), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private onData(chunk: Buffer): void {
    const rawSentences = this.parser.push(chunk);
    for (const words of rawSentences) {
      const sentence = parseSentence(words);
      if (!sentence) continue;
      if (this.pendingRead) {
        clearTimeout(this.pendingRead.timer);
        const { resolve } = this.pendingRead;
        this.pendingRead = null;
        resolve(sentence);
      } else {
        this.sentenceQueue.push(sentence);
      }
    }
  }

  private readNextSentence(timeoutMs = this.readTimeoutMs): Promise<RouterOsSentence> {
    if (this.sentenceQueue.length > 0) {
      return Promise.resolve(this.sentenceQueue.shift()!);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRead = null;
        reject(new RouterOsApiError('Read timeout waiting for API response'));
      }, timeoutMs);

      this.pendingRead = { resolve, reject, timer };
    });
  }

  private rejectPending(error: Error): void {
    if (!this.pendingRead) return;
    clearTimeout(this.pendingRead.timer);
    const { reject } = this.pendingRead;
    this.pendingRead = null;
    reject(error);
  }
}

/**
 * Abre conexión, autentica y ejecuta UNA sentencia de lectura (print).
 * Devuelve las filas !re como objetos. Cierra siempre la conexión.
 *
 * Preferir `routerOsReadMany` cuando haya varios prints: un login por lote
 * evita spam de login/logout en el log del MikroTik.
 */
export async function routerOsRead(
  command: string,
  opts: RouterOsReadOptions,
): Promise<Record<string, string>[]> {
  const [rows] = await routerOsReadMany([command], opts);
  return rows ?? [];
}

/**
 * Un solo login → N lecturas → un logout.
 * Patrón correcto para NOC/verify: no reautenticar por cada `print`.
 */
export async function routerOsReadMany(
  commands: readonly string[],
  opts: RouterOsReadOptions,
): Promise<Record<string, string>[][]> {
  if (commands.length === 0) return [];

  const timeoutMs = opts.timeoutMs ?? 4000;
  const client = new RouterOsApiClient({
    host: opts.host,
    port: opts.port,
    username: opts.username,
    password: opts.password,
    connectTimeoutMs: timeoutMs,
    readTimeoutMs: timeoutMs,
    useTls: opts.useTls,
    rejectUnauthorized: opts.rejectUnauthorized,
  });

  try {
    await client.connect();
    const results: Record<string, string>[][] = [];
    for (const command of commands) {
      results.push(await client.execute(command));
    }
    return results;
  } finally {
    client.disconnect();
  }
}

/** Resuelve host/puerto/TLS para un router del registro MikroTik. */
export const resolveRouterApiEndpoint = (input: {
  apiPort: number;
  apiSslPort?: number;
  preferTls?: boolean;
}): { port: number; useTls: boolean } => {
  const preferTls = input.preferTls ?? false;
  if (preferTls && input.apiSslPort) {
    return { port: input.apiSslPort, useTls: true };
  }
  if (input.apiPort === 8729) {
    return { port: input.apiPort, useTls: true };
  }
  return { port: input.apiPort, useTls: false };
};
