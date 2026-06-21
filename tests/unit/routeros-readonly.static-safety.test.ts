import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-3 — Seguridad estática del dominio RouterOS Read-Only.
//
// Garantiza que el dominio sea FÍSICAMENTE INCAPAZ de escribir: ningún
// archivo bajo backend/domains/routeros-readonly puede contener tokens de
// escritura/ejecución RouterOS ni llamadas mutables. Si esta prueba falla,
// la fase dejó de ser read-only y debe corregirse antes de avanzar.
// ====================================================================

const DOMAIN_DIR = 'backend/domains/routeros-readonly';

// Tokens prohibidos: escritura/ejecución RouterOS y mutaciones de runtime.
const FORBIDDEN_TOKENS = [
  '.add(',
  '.set(',
  '.remove(',
  '.execute(',
  '/ip firewall add',
  '/ip route add',
  '/queue simple add',
  '/ppp secret add',
  '/interface add',
  '/tool fetch',
];

const collectFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
};

describe('RouterOS Read-Only static safety', () => {
  const files = collectFiles(DOMAIN_DIR);

  it('el dominio contiene archivos para analizar', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_TOKENS)('ningún archivo del dominio contiene el token de escritura "%s"', (token) => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(token));
    expect(offenders, `Token de escritura "${token}" hallado en: ${offenders.join(', ')}`).toEqual([]);
  });
});
