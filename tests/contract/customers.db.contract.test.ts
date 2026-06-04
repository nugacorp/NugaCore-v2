import { describe, it, expect } from 'vitest';
import type { Client } from '../../src/types';

// ====================================================================
// Prueba de contrato del modo DB (Supabase real) — NO hermética.
//
// Opt-in EXPLÍCITO: solo corre con RUN_DB_TESTS=true (lo activa el script
// `npm run test:db`). Sin ese flag se OMITE, para que `npm test` sea
// hermético, estable y rápido aunque el .env apunte a una Supabase real.
//
// Si se opta por correrla pero faltan credenciales, FALLA con un mensaje
// claro (en vez de un skip silencioso o un timeout engañoso).
//
// Verifica que el repository de Supabase cumple el mismo contrato (Client)
// y que un cliente creado PERSISTE (lectura posterior lo encuentra).
// ====================================================================

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Tiempo extra: estas pruebas dependen de la red (Supabase Cloud).
const DB_TIMEOUT_MS = 30000;

// Opt-in sin credenciales -> error explícito (no imprime valores de secretos).
if (optIn && !hasSupabase) {
  describe('Customers DB contract — configuración requerida', () => {
    it('RUN_DB_TESTS=true exige SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY', () => {
      throw new Error(
        'RUN_DB_TESTS=true pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
          'Define ambas para apuntar a una Supabase real, o ejecuta la suite ' +
          'hermética con `npm test`.',
      );
    });
  });
}

describe.skipIf(!optIn || !hasSupabase)('Customers DB contract (Supabase staging)', () => {
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
  }, DB_TIMEOUT_MS);

  it('list devuelve un arreglo de Client', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabaseCustomersRepository } = await import('../../backend/domains/customers/repository');
    const repo = new SupabaseCustomersRepository(supabaseAdmin!);
    const rows = await repo.list({});
    expect(Array.isArray(rows)).toBe(true);
  }, DB_TIMEOUT_MS);
});
