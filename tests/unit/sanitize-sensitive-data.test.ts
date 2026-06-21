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

  it('redacta por completo cualquier texto con indicio sensible', () => {
    expect(sanitizeText('password=SUPERSECRET')).toBe(REDACTED);
    expect(sanitizeText('token: abc.def')).toBe(REDACTED);
    expect(sanitizeText('Authorization: Bearer eyJhbGciOi.JpZCI.sig')).toBe(REDACTED);
  });

  it('deja intacto texto sin secretos', () => {
    expect(sanitizeText('Lectura segura de recursos')).toBe('Lectura segura de recursos');
  });
});

describe('sanitizeText — free-text sentinels (segundo hotfix)', () => {
  it('Caso 1: token=PROD1_SENTINEL_TOKEN → [REDACTED]', () => {
    expect(sanitizeText('token=PROD1_SENTINEL_TOKEN')).toBe(REDACTED);
  });

  it('Caso 2: password=PROD1_SENTINEL_PASSWORD → [REDACTED]', () => {
    expect(sanitizeText('password=PROD1_SENTINEL_PASSWORD')).toBe(REDACTED);
  });

  it('Caso 3: privateKey=PROD1_SENTINEL_PRIVATE → [REDACTED]', () => {
    expect(sanitizeText('privateKey=PROD1_SENTINEL_PRIVATE')).toBe(REDACTED);
  });

  it('Caso 4: Authorization: Bearer PROD1_SENTINEL_AUTH → [REDACTED]', () => {
    expect(sanitizeText('Authorization: Bearer PROD1_SENTINEL_AUTH')).toBe(REDACTED);
  });

  it('Caso 5: sentinel en cualquier parte del texto → [REDACTED]', () => {
    expect(sanitizeText('Descripción normal con PROD1_SENTINEL_DESCRIPTION dentro')).toBe(REDACTED);
    expect(sanitizeText('PROD1_SENTINEL_X')).toBe(REDACTED);
  });

  it('Caso 6: script RouterOS → [REDACTED_ROUTEROS_SCRIPT]', () => {
    expect(sanitizeText('/system identity set name=core')).toBe(REDACTED_ROUTEROS_SCRIPT);
  });

  it('Caso 7: string normal sin secreto se conserva', () => {
    expect(sanitizeText('Reinicio programado de mantenimiento')).toBe('Reinicio programado de mantenimiento');
  });

  it('todas las variantes de asignación key=value se redactan completas', () => {
    for (const text of [
      'accessToken=PROD1_SENTINEL_X',
      'refreshToken=PROD1_SENTINEL_X',
      'secret=PROD1_SENTINEL_X',
      'private_key=PROD1_SENTINEL_X',
      'presharedKey=PROD1_SENTINEL_X',
      'preshared_key=PROD1_SENTINEL_X',
      'credentials=PROD1_SENTINEL_X',
      'encrypted_password=PROD1_SENTINEL_X',
      'encryptedPassword=PROD1_SENTINEL_X',
      'serviceRole=PROD1_SENTINEL_X',
      'jwt=PROD1_SENTINEL_X',
      'apiKey=PROD1_SENTINEL_X',
      'api_key=PROD1_SENTINEL_X',
      'clientSecret=PROD1_SENTINEL_X',
      'client_secret=PROD1_SENTINEL_X',
    ]) {
      expect(sanitizeText(text), `${text} debería redactarse completo`).toBe(REDACTED);
    }
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
