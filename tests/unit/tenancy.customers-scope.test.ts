import { describe, expect, it } from 'vitest';
import { StoreCustomersRepository } from '../../backend/domains/customers/repository';
import type { Client } from '../../src/types';

const baseClient = (overrides: Partial<Client>): Client => ({
  id: overrides.id || 'c-test',
  name: overrides.name || 'Test',
  type: 'residential',
  status: 'active',
  email: 'a@b.com',
  phone: '555',
  address: 'Calle 1',
  city: 'CDMX',
  lat: 0,
  lng: 0,
  planId: 'plan-basic',
  ip: '0.0.0.0',
  ...overrides,
});

describe('Customers tenant scope (store)', () => {
  it('lista solo clientes del tenant solicitado', async () => {
    const repo = new StoreCustomersRepository();
    // Usa el store global: crear y filtrar sin contaminar demasiado
    const a = baseClient({ id: `c-mt-a-${Date.now()}`, name: 'A', tenantId: 'tenant-a' });
    const b = baseClient({ id: `c-mt-b-${Date.now()}`, name: 'B', tenantId: 'tenant-b' });
    await repo.create(a);
    await repo.create(b);

    const onlyA = await repo.list({ tenantId: 'tenant-a' });
    expect(onlyA.some((c) => c.id === a.id)).toBe(true);
    expect(onlyA.some((c) => c.id === b.id)).toBe(false);

    expect(await repo.findById(b.id, 'tenant-a')).toBeNull();
    expect(await repo.findById(b.id, 'tenant-b')).not.toBeNull();

    await repo.remove(a.id, 'tenant-a');
    await repo.remove(b.id, 'tenant-b');
  });
});
