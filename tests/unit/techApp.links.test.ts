import { describe, expect, it } from 'vitest';
import { buildTechAppShareUrl } from '../../src/lib/techAppLinks';

describe('techAppLinks', () => {
  it('arma URL pública con app=tech', () => {
    expect(buildTechAppShareUrl('https://nugacore.example')).toBe(
      'https://nugacore.example/?app=tech',
    );
  });

  it('limpia path/query previos del origin', () => {
    expect(buildTechAppShareUrl('https://nugacore.example/admin?x=1')).toBe(
      'https://nugacore.example/?app=tech',
    );
  });
});
