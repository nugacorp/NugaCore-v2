import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('FTTH nap_ports embed', () => {
  it('usa hint FK nap_id para evitar ambigüedad PostgREST con continues_to_nap_id', () => {
    const src = readFileSync(
      resolve(__dirname, '../../backend/domains/network/ftth-service.ts'),
      'utf8',
    );
    expect(src).toContain("nap_ports!nap_id(*)");
    expect(src).not.toMatch(/\.select\('*\s*,\s*nap_ports\(\*\)'/);
  });
});
