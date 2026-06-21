import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-3 RouterOS Read-Only Lab — hard safety guard.
// El dominio debe ser físicamente incapaz de modificar routers.
// ====================================================================

const domainDir = 'backend/domains/routeros-readonly';

const readDomainSources = (): string => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      if (st.isFile() && /\.(ts|tsx)$/.test(entry)) files.push(path);
    }
  };
  walk(domainDir);
  return files.map((path) => readFileSync(path, 'utf8')).join('\n');
};

describe('RouterOS Read-Only Lab safety guard', () => {
  it('no contiene APIs ni verbos de escritura RouterOS', () => {
    const source = readDomainSources();
    for (const forbidden of [
      '.set(',
      '.add(',
      '.remove(',
      '.execute(',
      '/ip firewall add',
      '/ip route add',
      '/queue simple add',
      '/ppp secret add',
      '/interface add',
      '/tool fetch',
    ]) {
      expect(source, `prohibido en dominio routeros-readonly: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('solo registra rutas GET dentro del dominio', () => {
    const routes = readFileSync(`${domainDir}/routes.ts`, 'utf8');
    expect(routes).toContain('router.get(');
    for (const forbidden of ['router.post(', 'router.put(', 'router.patch(', 'router.delete(']) {
      expect(routes).not.toContain(forbidden);
    }
  });

  // PROD-4 — el provider RouterOS real debe ser incapaz de escribir.
  it('routeros-provider no contiene APIs ni verbos de escritura RouterOS', () => {
    const source = readFileSync(`${domainDir}/providers/routeros-provider.ts`, 'utf8');
    for (const forbidden of [
      '.set(',
      '.add(',
      '.remove(',
      '.execute(',
      '/ip firewall add',
      '/ip route add',
      '/queue simple add',
      '/ppp secret add',
      '/interface add',
      '/tool fetch',
    ]) {
      expect(source, `prohibido en routeros-provider: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('routeros-provider solo usa comandos print de allowlist', () => {
    const source = readFileSync(`${domainDir}/providers/routeros-provider.ts`, 'utf8');
    expect(source).toContain('READ_ONLY_COMMANDS');
    expect(source).toContain("'/system/identity/print'");
    expect(source).toContain("'/ip/route/print'");
  });
});
