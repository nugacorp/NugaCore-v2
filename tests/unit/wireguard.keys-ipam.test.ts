import { describe, it, expect } from 'vitest';
import { generateWgKeyPair, generatePresharedKey, isWgKey } from '../../backend/domains/wireguard/keys';
import { nextFreeIp, DEFAULT_WG_POOL } from '../../backend/domains/wireguard/ipam';

// ====================================================================
// Fase 4.6.1 — Claves WireGuard + IPAM.
// ====================================================================

describe('WireGuard keys', () => {
  it('genera un par válido (44 chars base64) y distinto cada vez', () => {
    const a = generateWgKeyPair();
    const b = generateWgKeyPair();
    expect(isWgKey(a.publicKey)).toBe(true);
    expect(isWgKey(a.privateKey)).toBe(true);
    expect(a.privateKey).not.toBe(a.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
  it('preshared key válida y única', () => {
    expect(isWgKey(generatePresharedKey())).toBe(true);
    expect(generatePresharedKey()).not.toBe(generatePresharedKey());
  });
});

describe('IPAM 10.70.0.0/16', () => {
  it('primera IP libre es .2 (reserva .1 para el servidor)', () => {
    expect(nextFreeIp([], DEFAULT_WG_POOL)).toBe('10.70.0.2');
  });
  it('asigna secuencialmente evitando duplicados', () => {
    const allocs = [{ ip: '10.70.0.2', status: 'allocated' as const }];
    expect(nextFreeIp(allocs, DEFAULT_WG_POOL)).toBe('10.70.0.3');
  });
  it('reutiliza la IP liberada más baja', () => {
    const allocs = [
      { ip: '10.70.0.2', status: 'allocated' as const },
      { ip: '10.70.0.3', status: 'released' as const },
      { ip: '10.70.0.4', status: 'allocated' as const },
    ];
    expect(nextFreeIp(allocs, DEFAULT_WG_POOL)).toBe('10.70.0.3');
  });
  it('nunca asigna la IP del servidor (.1)', () => {
    const ip = nextFreeIp([], DEFAULT_WG_POOL, ['10.70.0.1']);
    expect(ip).not.toBe('10.70.0.1');
  });
});
