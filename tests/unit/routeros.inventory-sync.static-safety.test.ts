import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ====================================================================
// PROD-6 Inventory Sync — hard safety guard. El dominio debe ser físicamente
// incapaz de modificar routers o ejecutar comandos: solo lectura.
// ====================================================================

const domainDir = 'backend/domains/inventory-sync';

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

describe('Inventory Sync safety guard', () => {
  it('no contiene APIs ni verbos de escritura RouterOS', () => {
    const source = readDomainSources();
    for (const forbidden of [
      '.add(',
      '.set(',
      '.remove(',
      '.execute(',
      '.disable(',
      '.enable(',
      '/tool fetch',
      '/ip firewall add',
      '/ip route add',
      '/queue simple add',
      '/ppp secret add',
      '/interface add',
    ]) {
      expect(source, `prohibido en inventory-sync: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('solo registra rutas GET dentro del dominio', () => {
    const routes = readFileSync(`${domainDir}/routes.ts`, 'utf8');
    expect(routes).toContain('router.get(');
    for (const forbidden of ['router.post(', 'router.put(', 'router.patch(', 'router.delete(']) {
      expect(routes).not.toContain(forbidden);
    }
  });

  it('el snapshot solo lee del RouterOS Read-Only Service (sin escritura)', () => {
    const snapshot = readFileSync(`${domainDir}/snapshot.ts`, 'utf8');
    expect(snapshot).toContain('routerOsReadOnlyService');
    // No debe invocar acciones de escritura/ejecución.
    for (const forbidden of ['execute', 'provision', 'reboot', 'commit']) {
      expect(snapshot.toLowerCase()).not.toContain(forbidden);
    }
  });
});
