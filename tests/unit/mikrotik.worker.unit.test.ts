import { describe, it, expect } from 'vitest';
import { encodeLength } from '../../backend/domains/mikrotik/worker/routeros-client';
import { DefaultRouterConnector, isLiveWorkerEnabled } from '../../backend/domains/mikrotik/worker/connector';
import { READ_ONLY_COMMANDS } from '../../backend/domains/mikrotik/worker/types';
import type { MikrotikRouterRegistryItem } from '../../backend/state/store';

// ====================================================================
// Fase 4.6 — Worker MikroTik: codificación del protocolo + conector.
// ====================================================================

describe('RouterOS encodeLength', () => {
  it('1 byte para len < 0x80', () => {
    expect([...encodeLength(0)]).toEqual([0]);
    expect([...encodeLength(0x7f)]).toEqual([0x7f]);
  });
  it('2 bytes para len < 0x4000', () => {
    expect([...encodeLength(0x80)]).toEqual([0x80, 0x80]);
    expect([...encodeLength(0x3fff)]).toEqual([0xbf, 0xff]);
  });
  it('3 bytes para len < 0x200000', () => {
    expect([...encodeLength(0x4000)]).toEqual([0xc0, 0x40, 0x00]);
  });
});

const fakeRouter = (over: Partial<MikrotikRouterRegistryItem> = {}): MikrotikRouterRegistryItem => ({
  id: 'mkt-x', name: 'Router X', ipAddress: '10.0.0.9', apiPort: 8728, username: 'nugacore_x',
  encryptedPassword: '', isOnline: true, cpuUsagePct: 0, memoryUsagePct: 0, routerOsVersion: '7.12',
  lastHealthCheckAt: '2026-06-05 00:00', connectionType: 'wireguard', managementIp: '10.0.0.9', apiSslPort: 8729,
  ...over,
});

describe('DefaultRouterConnector (simulado por defecto)', () => {
  const connector = new DefaultRouterConnector();

  it('live está deshabilitado por defecto (sin MIKROTIK_WORKER_LIVE)', () => {
    expect(isLiveWorkerEnabled()).toBe(false);
  });

  it('lee comandos de la allowlist en modo simulado', async () => {
    const r = await connector.read(fakeRouter(), '/system/resource/print');
    expect(r.ok).toBe(true);
    expect(r.source).toBe('simulated');
    expect(r.data).toContain('version');
  });

  it('rechaza comandos fuera de la allowlist (no read-only)', async () => {
    const r = await connector.read(fakeRouter(), '/system/reboot');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/read-only/i);
  });

  it('snapshot devuelve una lectura por comando de la allowlist', async () => {
    const snap = await connector.snapshot(fakeRouter());
    expect(snap.source).toBe('simulated');
    expect(snap.reads.length).toBe(READ_ONLY_COMMANDS.length);
    expect(snap.reads.every((x) => x.ok)).toBe(true);
  });
});
