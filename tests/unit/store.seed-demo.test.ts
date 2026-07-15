import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const storeSource = readFileSync('backend/state/store.ts', 'utf8');

describe('store — SEED_DEMO_DATA / PUBLIC_DEPLOYMENT', () => {
  it('exporta seedDemoData y limpia torres/OLT/clientes demo cuando está off', () => {
    expect(storeSource).toContain('export const seedDemoData');
    expect(storeSource).toContain('if (!seedDemoData())');
    expect(storeSource).toContain('store.TOWERS = []');
    expect(storeSource).toContain('store.OLTS = []');
    expect(storeSource).toContain('store.NAP_BOXES = []');
    expect(storeSource).toContain('store.CLIENTS = []');
    expect(storeSource).toContain('store.MIKROTIK_ROUTERS = []');
  });

  it('documenta que producción no debe servir Ajusco/San Pedro ficticios', () => {
    expect(storeSource).toContain('NO se sirven datos demo/mock');
  });
});
