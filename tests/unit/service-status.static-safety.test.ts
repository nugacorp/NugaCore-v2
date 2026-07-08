import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ====================================================================
// Service Status — hard safety guard (Pre-PROD-7).
//
// El dominio DEFINE y CALCULA estado; NO debe ser capaz de ejecutar cambios
// reales en la red ni en equipos. El escaneo estático falla si aparece
// cualquier API/verbo de ejecución, integración con el worker en vivo, shell,
// o estados de ejecución (EXECUTED/RUNNING) que pertenecen a PROD-7.
// ====================================================================

const domainDir = 'backend/domains/service-status';

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

describe('Service Status safety guard', () => {
  const source = readDomainSources();
  const lower = source.toLowerCase();

  it('no integra RouterOS / MikroTik ni el worker en vivo', () => {
    for (const forbidden of ['routeros', 'mikrotik', 'worker', 'shell']) {
      expect(lower, `prohibido en service-status: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('no contiene verbos de ejecución (API de escritura / comandos)', () => {
    for (const forbidden of [
      '.add(',
      '.set(',
      '.remove(',
      '.execute(',
      '.exec(',
      'execsync',
      'spawn(',
      'child_process',
      '/ppp secret',
      '/ip firewall',
      '/queue simple',
      '/system reboot',
      '/tool fetch',
    ]) {
      expect(lower, `prohibido en service-status: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('no introduce estados de ejecución reservados a PROD-7', () => {
    expect(source).not.toContain('EXECUTED');
    expect(source).not.toContain('RUNNING');
  });

  it('expone endpoints de lectura y de solicitud dryRun', () => {
    const routes = readFileSync(`${domainDir}/routes.ts`, 'utf8');
    expect(routes).toContain('router.get(');
    expect(routes).toContain('request-suspension');
    expect(routes).toContain('request-reactivation');
    expect(source).toContain('dryRun');
    expect(source).toContain('productionGates.serviceStatusLive');
  });
});
