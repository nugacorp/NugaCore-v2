import { describe, it, expect, vi } from 'vitest';

describe('legacy guards', () => {
  it('legacy suspension disabled when suspension on DB', async () => {
    vi.resetModules();
    const prev = process.env.USE_DB_SUSPENSION;
    process.env.USE_DB_SUSPENSION = 'true';
    const { legacySuspensionDisabled } = await import('../../backend/domains/suspension/legacy-guard');
    expect(legacySuspensionDisabled()).toBe(true);
    process.env.USE_DB_SUSPENSION = prev;
  });

  it('legacy automations disabled in production', async () => {
    vi.resetModules();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { legacyAutomationsDisabled } = await import('../../backend/domains/automations/legacy-guard');
    expect(legacyAutomationsDisabled()).toBe(true);
    process.env.NODE_ENV = prev;
  });
});
