import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  REDACTED_ROUTEROS_SCRIPT,
  isSensitiveKey,
  looksLikeRouterOsScript,
  sanitizeSensitiveData,
  sanitizeText,
} from '../../backend/common/security/sanitize-sensitive-data';

// ====================================================================
// PROD-1 Security Sanitization — utilidad central de saneo profundo.
// ====================================================================

describe('sanitizeSensitiveData — deep key-based redaction', () => {
  it('Caso 1: clave sensible plana', () => {
    expect(sanitizeSensitiveData({ token: 'abc' })).toEqual({ token: REDACTED });
  });

  it('Caso 2: objeto anidado', () => {
    expect(sanitizeSensitiveData({ wireguard: { privateKey: 'xyz' } })).toEqual({
      wireguard: { privateKey: REDACTED },
    });
  });

  it('Caso 3: array de objetos', () => {
    expect(
      sanitizeSensitiveData([
        { password: 'p1', label: 'a' },
        { nested: { secret: 's' }, ok: 1 },
      ]),
    ).toEqual([
      { password: REDACTED, label: 'a' },
      { nested: { secret: REDACTED }, ok: 1 },
    ]);
  });

  it('redacta todas las variantes de clave obligatorias', () => {
    const input = {
      token: 'a',
      accessToken: 'a',
      refreshToken: 'a',
      authorization: 'a',
      password: 'a',
      secret: 'a',
      privateKey: 'a',
      private_key: 'a',
      presharedKey: 'a',
      preshared_key: 'a',
      credentials: 'a',
      credential: 'a',
      encrypted_password: 'a',
      encryptedPassword: 'a',
      serviceRole: 'a',
      jwt: 'a',
      bearer: 'a',
      apiKey: 'a',
      api_key: 'a',
      clientSecret: 'a',
      client_secret: 'a',
    };
    const out = sanitizeSensitiveData(input) as Record<string, string>;
    for (const key of Object.keys(input)) {
      expect(out[key], `${key} debería estar redactado`).toBe(REDACTED);
    }
  });

  it('conserva valores no sensibles', () => {
    const input = { name: 'router-1', count: 3, enabled: true, missing: null };
    expect(sanitizeSensitiveData(input)).toEqual(input);
  });

  it('no rompe con valores primitivos / null', () => {
    expect(sanitizeSensitiveData(42)).toBe(42);
    expect(sanitizeSensitiveData(null)).toBe(null);
    expect(sanitizeSensitiveData(true)).toBe(true);
  });
});

describe('sanitizeText — RouterOS y secretos embebidos', () => {
  it('Caso 4: bloque de script RouterOS', () => {
    const script = '/system identity set name=core\n/ip firewall filter add chain=input';
    expect(sanitizeText(script)).toBe(REDACTED_ROUTEROS_SCRIPT);
    expect(looksLikeRouterOsScript(script)).toBe(true);
  });

  it('detecta /interface wireguard, /ppp secret, /user add', () => {
    expect(sanitizeText('/interface wireguard add name=wg0')).toBe(REDACTED_ROUTEROS_SCRIPT);
    expect(sanitizeText('/ppp secret add name=client')).toBe(REDACTED_ROUTEROS_SCRIPT);
    expect(sanitizeText('/user add name=admin group=full')).toBe(REDACTED_ROUTEROS_SCRIPT);
  });

  it('redacta secretos embebidos en texto libre', () => {
    expect(sanitizeText('password=SUPERSECRET')).toBe(`password=${REDACTED}`);
    expect(sanitizeText('token: abc.def')).toContain(REDACTED);
    expect(sanitizeText('Authorization: Bearer eyJhbGciOi.JpZCI.sig')).toContain(REDACTED);
  });

  it('deja intacto texto sin secretos', () => {
    expect(sanitizeText('Lectura segura de recursos')).toBe('Lectura segura de recursos');
  });
});

describe('isSensitiveKey', () => {
  it('reconoce variantes camelCase/snake_case', () => {
    for (const k of ['token', 'accessToken', 'private_key', 'clientSecret', 'api_key', 'preshared_key']) {
      expect(isSensitiveKey(k), `${k} debería ser sensible`).toBe(true);
    }
    for (const k of ['name', 'targetId', 'description', 'count']) {
      expect(isSensitiveKey(k), `${k} NO debería ser sensible`).toBe(false);
    }
  });
});
