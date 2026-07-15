import { describe, expect, it } from 'vitest';
import { buildPortalShareUrl, readPortalClientIdFromSearch } from '../../src/lib/portalLinks';

describe('portalLinks', () => {
  it('arma URL pública con app=portal y client', () => {
    expect(buildPortalShareUrl('https://nugacore.example', 'cli-42')).toBe(
      'https://nugacore.example/?app=portal&client=cli-42',
    );
  });

  it('limpia path/query previos del origin', () => {
    expect(buildPortalShareUrl('https://nugacore.example/admin?x=1', 'c1')).toBe(
      'https://nugacore.example/?app=portal&client=c1',
    );
  });

  it('lee client desde el query', () => {
    expect(readPortalClientIdFromSearch('?app=portal&client=abc')).toBe('abc');
    expect(readPortalClientIdFromSearch('clientId=xyz')).toBe('xyz');
    expect(readPortalClientIdFromSearch('')).toBeNull();
  });
});
