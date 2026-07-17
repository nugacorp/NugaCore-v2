import { afterEach, describe, expect, it } from 'vitest';
import { resolveAuthRedirectUrl } from '../../backend/domains/auth/auth-email';

describe('resolveAuthRedirectUrl', () => {
  const prev = process.env.APP_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  });

  it('usa APP_URL + path por defecto', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(resolveAuthRedirectUrl(undefined, '/auth/callback')).toBe(
      'https://app.example.com/auth/callback',
    );
    expect(resolveAuthRedirectUrl(undefined, '/reset-password')).toBe(
      'https://app.example.com/reset-password',
    );
  });

  it('acepta redirect del mismo origen', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(
      resolveAuthRedirectUrl('https://app.example.com/auth/callback', '/auth/callback'),
    ).toBe('https://app.example.com/auth/callback');
  });

  it('rechaza origen distinto', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(
      resolveAuthRedirectUrl('https://evil.example/phish', '/auth/callback'),
    ).toBe('https://app.example.com/auth/callback');
  });
});
