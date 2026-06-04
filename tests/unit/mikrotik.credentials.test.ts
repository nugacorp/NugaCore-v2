import { describe, it, expect } from 'vitest';
import {
  generateApiUsername,
  generateStrongPassword,
  generateProvisioningToken,
  generateApiCredential,
  sha256Hex,
} from '../../backend/domains/mikrotik/provisioning/credentials';
import { decryptSecret } from '../../backend/services/crypto';

// ====================================================================
// Fase 4.4 — generación de credenciales de provisioning MikroTik.
// ====================================================================

describe('mikrotik credentials — username', () => {
  it('usa el prefijo nugacore_ y solo alfanumérico', () => {
    const u = generateApiUsername('mkt-1');
    expect(u).toMatch(/^nugacore_[a-z0-9]+$/);
  });
  it('genera usernames distintos (único por router)', () => {
    expect(generateApiUsername('mkt-1')).not.toBe(generateApiUsername('mkt-1'));
  });
});

describe('mikrotik credentials — password', () => {
  it('tiene al menos 32 caracteres', () => {
    expect(generateStrongPassword().length).toBeGreaterThanOrEqual(32);
  });
  it('respeta una longitud mínima de 32 aunque se pida menos', () => {
    expect(generateStrongPassword(8).length).toBe(32);
  });
  it('solo usa caracteres seguros para scripts RouterOS', () => {
    expect(generateStrongPassword(64)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('genera passwords distintos cada vez', () => {
    expect(generateStrongPassword()).not.toBe(generateStrongPassword());
  });
});

describe('mikrotik credentials — token de un solo uso', () => {
  it('devuelve token, hash sha256 (hex 64) y expiración futura', () => {
    const t = generateProvisioningToken(1);
    expect(t.token.length).toBeGreaterThan(20);
    expect(t.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(t.tokenHash).toBe(sha256Hex(t.token));
    expect(new Date(t.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
  it('genera tokens distintos cada vez', () => {
    expect(generateProvisioningToken().token).not.toBe(generateProvisioningToken().token);
  });
});

describe('mikrotik credentials — credencial API cifrada', () => {
  it('cifra el password de forma reversible y no lo expone en claro en el campo cifrado', () => {
    const cred = generateApiCredential('mkt-1');
    expect(cred.username).toMatch(/^nugacore_/);
    expect(cred.encryptionVersion).toBe('v1-aes-256-gcm');
    expect(cred.plainPassword.length).toBeGreaterThanOrEqual(32);
    // El blob cifrado no contiene el password en claro.
    expect(cred.encryptedPassword).not.toContain(cred.plainPassword);
    // Round-trip: descifra al mismo valor.
    expect(decryptSecret(cred.encryptedPassword)).toBe(cred.plainPassword);
  });
});
