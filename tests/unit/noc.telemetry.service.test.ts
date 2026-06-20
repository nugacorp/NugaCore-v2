import { describe, expect, it } from 'vitest';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { Tower } from '../../src/types';
import {
  UNASSIGNED_TOWER_ID,
  UNASSIGNED_TOWER_NAME,
  aggregateTowers,
  summarizeHealth,
} from '../../backend/domains/noc-telemetry/mappers';

// ====================================================================
// Lógica pura de telemetría NOC (Fase 4.11.3): summarizeHealth + aggregateTowers.
// ====================================================================

const SAME_CHECK = '2026-06-18 10:00';

const router = (over: Partial<MikrotikRouterRegistryItem> & { id: string }): MikrotikRouterRegistryItem => ({
  id: over.id,
  name: over.name ?? `Router ${over.id}`,
  ipAddress: '10.0.0.1',
  apiPort: 8728,
  username: 'nuga',
  encryptedPassword: '',
  isOnline: over.isOnline ?? true,
  cpuUsagePct: over.cpuUsagePct ?? 0,
  memoryUsagePct: over.memoryUsagePct ?? 0,
  routerOsVersion: '7.15',
  lastHealthCheckAt: over.lastHealthCheckAt ?? SAME_CHECK,
  ...over,
});

const tower = (id: string, name: string): Tower => ({ id, name } as Tower);

describe('summarizeHealth', () => {
  it('resumen estable sin routers', () => {
    expect(summarizeHealth([])).toEqual({
      totalRouters: 0,
      onlineRouters: 0,
      offlineRouters: 0,
      warningRouters: 0,
      criticalRouters: 0,
    });
  });

  it('clasifica online/offline y warning/critical por umbrales', () => {
    const result = summarizeHealth([
      router({ id: 'healthy', isOnline: true, cpuUsagePct: 10, memoryUsagePct: 10 }),
      router({ id: 'warn-cpu', isOnline: true, cpuUsagePct: 85, memoryUsagePct: 10 }),
      router({ id: 'warn-mem', isOnline: true, cpuUsagePct: 10, memoryUsagePct: 90 }),
      router({ id: 'crit-cpu', isOnline: true, cpuUsagePct: 95, memoryUsagePct: 10 }),
      router({ id: 'offline', isOnline: false }),
    ]);

    expect(result).toEqual({
      totalRouters: 5,
      onlineRouters: 4,
      offlineRouters: 1,
      warningRouters: 2,
      criticalRouters: 2, // crit-cpu + offline
    });
  });

  it('un router stale cuenta como warning', () => {
    const result = summarizeHealth([
      router({ id: 'fresh', isOnline: true, cpuUsagePct: 10, lastHealthCheckAt: '2026-06-18 10:00' }),
      router({ id: 'stale', isOnline: true, cpuUsagePct: 10, lastHealthCheckAt: '2026-06-17 00:00' }),
    ]);

    expect(result.warningRouters).toBe(1);
    expect(result.criticalRouters).toBe(0);
  });
});

describe('aggregateTowers', () => {
  it('sin routers devuelve []', () => {
    expect(aggregateTowers([tower('t-1', 'Torre 1')], [])).toEqual([]);
  });

  it('agrega routers por torre y resuelve nombre', () => {
    const towers = [tower('t-1', 'Torre Alfa'), tower('t-2', 'Torre Beta')];
    const result = aggregateTowers(towers, [
      router({ id: 'a1', isOnline: true, cpuUsagePct: 10, linkedTowerId: 't-1' }),
      router({ id: 'a2', isOnline: true, cpuUsagePct: 90, linkedTowerId: 't-1' }),
      router({ id: 'b1', isOnline: false, linkedTowerId: 't-2' }),
    ]);

    const byId = Object.fromEntries(result.map((row) => [row.towerId, row]));
    expect(byId['t-1']).toEqual({
      towerId: 't-1',
      towerName: 'Torre Alfa',
      totalRouters: 2,
      online: 2,
      offline: 0,
      warning: 1,
      critical: 0,
    });
    expect(byId['t-2']).toEqual({
      towerId: 't-2',
      towerName: 'Torre Beta',
      totalRouters: 1,
      online: 0,
      offline: 1,
      warning: 0,
      critical: 1,
    });
  });

  it('routers sin torre caen al bucket "Sin torre asignada"', () => {
    const result = aggregateTowers([], [router({ id: 'x', isOnline: false })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      towerId: UNASSIGNED_TOWER_ID,
      towerName: UNASSIGNED_TOWER_NAME,
      totalRouters: 1,
      offline: 1,
      critical: 1,
    });
  });

  it('torre referenciada pero no listada usa el id como nombre fallback', () => {
    const result = aggregateTowers([], [router({ id: 'x', linkedTowerId: 't-missing' })]);
    expect(result[0].towerId).toBe('t-missing');
    expect(result[0].towerName).toBe('t-missing');
  });

  it('orden estable por nombre de torre', () => {
    const towers = [tower('t-1', 'Zulu'), tower('t-2', 'Alfa')];
    const result = aggregateTowers(towers, [
      router({ id: 'z', linkedTowerId: 't-1' }),
      router({ id: 'a', linkedTowerId: 't-2' }),
    ]);
    expect(result.map((row) => row.towerName)).toEqual(['Alfa', 'Zulu']);
  });
});
