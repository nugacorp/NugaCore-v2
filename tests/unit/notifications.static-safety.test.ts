import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// FASE O — Static Safety. El Notification Engine NO debe poder enviar nada
// real en esta fase salvo vía providers-deliver.ts (gated, excluido aquí).
const DIR = 'backend/domains/notifications';

const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && f !== 'providers-deliver.ts')
  .map((f) => join(DIR, f));

const FORBIDDEN = [
  'fetch(',
  'axios',
  'twilio',
  'whatsapp real',
  'telegram bot api real',
  'nodemailer',
  'smtp',
  'sendgrid',
  'mailgun',
  'webpush',
  'push real',
  'sendmessage',
  'dispatch',
  'send(',
];

describe('notifications static safety (FASE O)', () => {
  it('incluye los archivos del dominio (sin deliver gated)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  it('no contiene primitivas de envío real ni clientes externos', () => {
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8').toLowerCase();
      for (const token of FORBIDDEN) {
        expect(source, `${file} contiene ${token}`).not.toContain(token);
      }
    }
  });
});
