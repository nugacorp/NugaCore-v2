import { describe, it, expect } from 'vitest';
import { inferEquipmentRole, buildZoneEquipment } from '../../backend/domains/dashboard/zone-status';
import type { Tower } from '../../src/types';

describe('zone-status', () => {
  it('clasifica roles de equipo', () => {
    expect(inferEquipmentRole('Router principal')).toBe('router');
    expect(inferEquipmentRole('Sectorial AP 5Ghz')).toBe('radio');
    expect(inferEquipmentRole('Switch SFP')).toBe('switch');
    expect(inferEquipmentRole('GPS timing')).toBe('gps');
  });

  it('combina telemetría de router con equipos del sitio', () => {
    const tower: Tower = {
      id: 't-3',
      name: 'Torre Ajusco (Sur-Master)',
      status: 'warning',
      lat: 0,
      lng: 0,
      height: 60,
      coverageRadiusKm: 15,
      ip: '10.0.1.3',
      cpu: 78,
      ram: 82,
      tempCelsius: 52,
      pingMs: 24,
      uptime: '158d',
      ports: [],
      equipment: [
        { name: 'CCR2116-12G-4S+', type: 'Router Core', brand: 'MikroTik' },
        { name: 'Mimosa A5c', type: 'Access Point Quad-Sector', brand: 'Mimosa' },
      ],
    };
    const routers = [{
      id: 'mkt-2',
      name: 'Torre Ajusco (Sur-Master)',
      ipAddress: '10.0.1.3',
      apiPort: 8728,
      username: 'admin',
      encryptedPassword: 'x',
      isOnline: true,
      cpuUsagePct: 88,
      memoryUsagePct: 82,
      routerOsVersion: '7.14',
      linkedTowerId: 't-3',
      lastHealthCheckAt: '2026-05-31 03:39',
    }];

    const rows = buildZoneEquipment(tower, routers, Date.parse('2026-05-31T03:39:00'));
    const routerRow = rows.find((r) => r.role === 'router');
    const radioRow = rows.find((r) => r.role === 'radio');

    expect(routerRow?.source).toBe('router-telemetry');
    expect(routerRow?.status).toBe('warning');
    expect(radioRow?.status).toBe('warning');
  });
});
