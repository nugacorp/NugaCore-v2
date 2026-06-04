import { describe, it, expect } from 'vitest';
import type { PlanRecord } from '../../backend/domains/plans/mappers';

// ====================================================================
// Prueba de contrato del modo DB (Supabase real) — NO hermética.
//
// Opt-in EXPLÍCITO: solo corre con RUN_DB_TESTS=true (lo activa el script
// `npm run test:db`). Sin ese flag se OMITE, para que `npm test` sea
// hermético, estable y rápido aunque el .env apunte a una Supabase real.
//
// Verifica que SupabasePlansRepository cumple el mismo contrato (PlanRecord)
// y que un plan creado PERSISTE (create -> find -> update -> remove).
// ====================================================================

const optIn = process.env.RUN_DB_TESTS === 'true';
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const DB_TIMEOUT_MS = 30000;

if (optIn && !hasSupabase) {
  describe('Plans DB contract — configuración requerida', () => {
    it('RUN_DB_TESTS=true exige SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY', () => {
      throw new Error(
        'RUN_DB_TESTS=true pero faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
          'Define ambas para apuntar a una Supabase real, o ejecuta la suite ' +
          'hermética con `npm test`.',
      );
    });
  });
}

describe.skipIf(!optIn || !hasSupabase)('Plans DB contract (Supabase staging)', () => {
  const testId = `plan-itest-${Date.now()}`;

  const sample: PlanRecord = {
    id: testId,
    name: `Integración Plan Test (borrar) ${Date.now()}`,
    speedMbpsDown: 80,
    speedMbpsUp: 40,
    price: 555,
    type: 'Static',
    businessType: 'Empresarial',
    isActive: true,
  };

  it('create -> findById persiste y respeta el contrato PlanRecord', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabasePlansRepository } = await import('../../backend/domains/plans/repository');
    expect(supabaseAdmin).not.toBeNull();
    const repo = new SupabasePlansRepository(supabaseAdmin!);

    const created = await repo.create(sample);
    expect(created.id).toBe(testId);
    expect(created.price).toBe(555);
    expect(created.type).toBe('Static');
    expect(created.businessType).toBe('Empresarial');

    const found = await repo.findById(testId);
    expect(found).not.toBeNull();
    expect(found?.name).toBe(sample.name);
    expect(found?.isActive).toBe(true);

    // findByName (case-insensitive) lo encuentra.
    const byName = await repo.findByName(sample.name.toUpperCase());
    expect(byName?.id).toBe(testId);

    const updated = await repo.update(testId, { isActive: false, price: 600 });
    expect(updated?.isActive).toBe(false);
    expect(updated?.price).toBe(600);

    // Un plan recién creado no está en uso por ningún cliente.
    expect(await repo.isInUse(testId)).toBe(false);

    const removed = await repo.remove(testId);
    expect(removed).toBe(true);
    expect(await repo.findById(testId)).toBeNull();
  }, DB_TIMEOUT_MS);

  it('list devuelve un arreglo de PlanRecord', async () => {
    const { supabaseAdmin } = await import('../../backend/services/supabase-admin');
    const { SupabasePlansRepository } = await import('../../backend/domains/plans/repository');
    const repo = new SupabasePlansRepository(supabaseAdmin!);
    const rows = await repo.list({});
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('speedMbpsDown');
      expect(rows[0]).toHaveProperty('businessType');
      expect(typeof rows[0].price).toBe('number');
    }
  }, DB_TIMEOUT_MS);
});
