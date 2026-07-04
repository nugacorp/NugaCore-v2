// ====================================================================
// Cliente mínimo del protocolo API de RouterOS (Fase 4.6) — SOLO LECTURA.
//
// Implementación propia sobre net.Socket (sin dependencias externas). Se usa
// únicamente para comandos de lectura "print" (allowlist en el conector).
// Soporta el login moderno (v6.43+) con fallback al challenge MD5 legacy.
//
// SEGURIDAD: el password se recibe ya descifrado en memoria y NUNCA se loguea.
// ====================================================================

import net from 'net';
import { createHash } from 'crypto';

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

const encodeWord = (word: string): Buffer => {
  const body = Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(body.length), body]);
};

const encodeSentence = (words: string[]): Buffer =>
  Buffer.concat([...words.map(encodeWord), Buffer.from([0])]);

// ── Decodificador incremental de sentencias ───────────────────────────
class SentenceParser {
  private buf = Buffer.alloc(0);
  private words: string[] = [];

  push(chunk: Buffer): string[][] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const sentences: string[][] = [];
     
    while (true) {
      const parsed = this.readWord();
      if (parsed === null) break; // datos incompletos
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
    const first = this.buf[0];
    let len: number;
    let header: number;
    if (first < 0x80) { len = first; header = 1; }
    else if (first < 0xc0) { if (this.buf.length < 2) return null; len = ((first & 0x3f) << 8) | this.buf[1]; header = 2; }
    else if (first < 0xe0) { if (this.buf.length < 3) return null; len = ((first & 0x1f) << 16) | (this.buf[1] << 8) | this.buf[2]; header = 3; }
    else if (first < 0xf0) { if (this.buf.length < 4) return null; len = ((first & 0x0f) << 24) | (this.buf[1] << 16) | (this.buf[2] << 8) | this.buf[3]; header = 4; }
    else { if (this.buf.length < 5) return null; len = (this.buf[1] << 24) | (this.buf[2] << 16) | (this.buf[3] << 8) | this.buf[4]; header = 5; }

    if (this.buf.length < header + len) return null;
    const word = this.buf.subarray(header, header + len).toString('utf8');
    this.buf = this.buf.subarray(header + len);
    return word;
  }
}

export interface RouterOsReadOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}

// Sentencia → objeto {key: value} a partir de palabras "=key=value".
const sentenceToObject = (words: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const w of words) {
    if (w.startsWith('=')) {
      const eq = w.indexOf('=', 1);
      if (eq > 0) out[w.substring(1, eq)] = w.substring(eq + 1);
    }
  }
  return out;
};

/**
 * Abre conexión, autentica y ejecuta UNA sentencia de lectura (print).
 * Devuelve las filas !re como objetos. Cierra siempre la conexión.
 */
export function routerOsRead(command: string, opts: RouterOsReadOptions): Promise<Record<string, string>[]> {
  const timeoutMs = opts.timeoutMs ?? 4000;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const parser = new SentenceParser();
    let stage: 'login' | 'legacy' | 'command' = 'login';
    const rows: Record<string, string>[] = [];
    let settled = false;

    const done = (err: Error | null, value?: Record<string, string>[]) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err); else resolve(value || []);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done(new Error('RouterOS API timeout')));
    socket.on('error', (e) => done(e));

    socket.on('data', (chunk) => {
      let sentences: string[][];
      try {
        sentences = parser.push(chunk);
      } catch (e) {
        done(e as Error);
        return;
      }
      for (const words of sentences) {
        const reply = words[0] || '';
        if (stage === 'login') {
          if (reply === '!done') {
            const obj = sentenceToObject(words);
            if (obj.ret) {
              // Login legacy: challenge MD5.
              stage = 'legacy';
              const hash = createHash('md5')
                .update(Buffer.concat([Buffer.from([0]), Buffer.from(opts.password, 'utf8'), Buffer.from(obj.ret, 'hex')]))
                .digest('hex');
              socket.write(encodeSentence(['/login', `=name=${opts.username}`, `=response=00${hash}`]));
            } else {
              // Login moderno OK → enviar comando.
              stage = 'command';
              socket.write(encodeSentence([command]));
            }
          } else if (reply === '!trap' || reply === '!fatal') {
            done(new Error('RouterOS login failed'));
            return;
          }
        } else if (stage === 'legacy') {
          if (reply === '!done') { stage = 'command'; socket.write(encodeSentence([command])); }
          else if (reply === '!trap' || reply === '!fatal') { done(new Error('RouterOS login failed')); return; }
        } else {
          if (reply === '!re') rows.push(sentenceToObject(words));
          else if (reply === '!done') { done(null, rows); return; }
          else if (reply === '!trap' || reply === '!fatal') { done(new Error('RouterOS command rejected')); return; }
        }
      }
    });

    socket.connect(opts.port, opts.host, () => {
      // Login moderno (v6.43+): name + password en la misma sentencia.
      socket.write(encodeSentence(['/login', `=name=${opts.username}`, `=password=${opts.password}`]));
    });
  });
}
