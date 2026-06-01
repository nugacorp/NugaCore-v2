import { describe, it, expect } from 'vitest';
import type { Client } from '../../src/types';

// ====================================================================
// Prueba de contrato del modo DB (USE_DB_CUSTOMERS=true).
//
// Se EJECUTA SOLO si hay un Supabase de staging configurado por entorno
// (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). En CI sin Supabase se OMITE,
// así el pipeline sigue verde. Requiere el esquema + seeds aplicados.
//
// Verifica que el repository de Supabase cumple el mismo contrato (Client)
// y que un cliente creado PERSISTE (lectura posterior lo encuentra).
// ====================================================================

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe.skipIf(!hasSupabase)('Customers DB contract (Supabase staging)', () => {
  const testId = `c-itest-${Date.now()}`;

  const sample: Client = {
    id: testId,
    name: 'Integración Test (borrar)',
    type: 'residential',
    status: 'active',
    email: 'itest@staging.local',
    phone: '0000000000',
    address: 'Calle Test 1',
    city: 'CDMX',
    lat: 19.4,
    lng: -99.1,
    planId: 'plan-basic',
    ip: '10.255.255.1',
    connectionType: 'FTTH',
  };

  it('create -> findById persiste y respeta el contrato Client', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseCustomersRepository } = await import('../../backend/domains/customers/repository');
    expect(supabaseAdmin).not.toBeNull();
    const repo = new SupabaseCustomersRepository(supabaseAdmin!);

    const created = await repo.create(sample);
    expect(created.id).toBe(testId);
    expect(created.status).toBe('active');

    const found = await repo.findById(testId);
    expect(found).not.toBeNull();
    expect(found?.name).toBe(sample.name);
    expect(found?.planId).toBe('plan-basic');

    const updated = await repo.update(testId, { status: 'suspended' });
    expect(updated?.status).toBe('suspended');

    const removed = await repo.remove(testId);
    expect(removed).toBe(true);
    expect(await repo.findById(testId)).toBeNull();
  });

  it('list devuelve un arreglo de Client', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseCustomersRepository } = await import('../../backend/domains/customers/repository');
    const repo = new SupabaseCustomersRepository(supabaseAdmin!);
    const rows = await repo.list({});
    expect(Array.isArray(rows)).toBe(true);
  });
});
