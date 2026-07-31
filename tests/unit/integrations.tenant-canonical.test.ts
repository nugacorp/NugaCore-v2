// ====================================================================
// MT-03 — `wisp_integration_settings.tenant_id` es la identidad canónica.
//
// El contrato que se sostiene aquí: TODA escritura estampa el tenant real y
// TODA lectura/upsert se acota por esa columna. El fake reproduce una tabla
// real (service role, sin RLS de por medio) justamente porque el backend
// habla con Supabase como admin: si el repositorio no acota por `tenant_id`,
// nada más lo hará. La columna legacy `id` se mantiene coherente durante la
// transición, pero deja de ser autoridad.
// ====================================================================

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseIntegrationsRepository,
  emptyIntegrationSettings,
} from '../../backend/domains/integrations/repository';

type Row = Record<string, unknown>;

/**
 * Tabla en memoria con la semántica que importa: el upsert resuelve conflictos
 * por la columna que pide `onConflict`, no por la PK. Así un `onConflict: 'id'`
 * sobre datos de otro WISP se manifiesta como lo que sería en Postgres.
 */
const makeFakeAdmin = (seed: Row[] = []) => {
  const table: Row[] = seed.map((r) => ({ ...r }));
  const calls: { filters: Array<[string, unknown]>; onConflict: string | null } = {
    filters: [],
    onConflict: null,
  };

  const admin = {
    from() {
      return {
        select() {
          const filters: Array<[string, unknown]> = [];
          const api = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              calls.filters.push([col, val]);
              return api;
            },
            get matched() {
              return table.filter((row) => filters.every(([c, v]) => row[c] === v));
            },
            async maybeSingle() {
              const m = api.matched;
              if (m.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
              return { data: m[0] ?? null, error: null };
            },
            async limit(n: number) {
              return { data: api.matched.slice(0, n), error: null };
            },
          };
          return api;
        },
        upsert(row: Row, opts?: { onConflict?: string }) {
          const key = opts?.onConflict ?? 'id';
          calls.onConflict = key;
          const at = table.findIndex((r) => r[key] === row[key]);
          if (at >= 0) table[at] = { ...table[at], ...row };
          else table.push({ ...row });
          const written = table[at >= 0 ? at : table.length - 1];
          return {
            select() {
              return { single: async () => ({ data: written, error: null }) };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { admin, table, calls };
};

const rowFor = (tenantId: string, id: string, extra: Row = {}): Row => ({
  id,
  tenant_id: tenantId,
  stripe_enabled: false,
  whatsapp_enabled: false,
  telegram_enabled: false,
  codi_enabled: false,
  openpay_enabled: false,
  openpay_sandbox: true,
  updated_at: '2026-07-30T00:00:00.000Z',
  ...extra,
});

describe('MT-03 — el repositorio estampa y acota por tenant_id', () => {
  it('una escritura para tenant-b persiste tenant_id="tenant-b" (no tenant-default)', async () => {
    const { admin, table } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    const rec = emptyIntegrationSettings();
    rec.openpayMerchantId = 'MERCHANT_B';
    await repo.save(rec, 'tenant-b');

    expect(table).toHaveLength(1);
    expect(table[0].tenant_id).toBe('tenant-b');
    // La columna legacy sigue coherente durante la transición.
    expect(table[0].id).toBe('tenant-b');
  });

  it('el WISP por defecto conserva id="default" con tenant_id="tenant-default"', async () => {
    const { admin, table } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    await repo.save(emptyIntegrationSettings(), 'tenant-default');
    expect(table[0].id).toBe('default');
    expect(table[0].tenant_id).toBe('tenant-default');

    // Sin tenant explícito resuelve al mismo WISP por defecto.
    await repo.save(emptyIntegrationSettings());
    expect(table).toHaveLength(1);
    expect(table[0].tenant_id).toBe('tenant-default');
  });

  it('normaliza igual tenant_id e id legacy para no crear identidades divergentes', async () => {
    const { admin, table } = makeFakeAdmin();
    const repo = new SupabaseIntegrationsRepository(admin);

    await repo.save(emptyIntegrationSettings(), '  tenant-b  ');

    expect(table[0].tenant_id).toBe('tenant-b');
    expect(table[0].id).toBe('tenant-b');
  });

  it('la lectura se acota por tenant_id, no por la columna legacy id', async () => {
    const { admin, calls } = makeFakeAdmin([rowFor('tenant-b', 'tenant-b')]);
    const repo = new SupabaseIntegrationsRepository(admin);

    await repo.getPersisted('tenant-b');
    expect(calls.filters).toContainEqual(['tenant_id', 'tenant-b']);
    expect(calls.filters.map(([c]) => c)).not.toContain('id');
  });

  it('A no puede leer la configuración de B con service role', async () => {
    const { admin } = makeFakeAdmin([
      rowFor('tenant-b', 'tenant-b', { openpay_merchant_id: 'MERCHANT_B' }),
    ]);
    const repo = new SupabaseIntegrationsRepository(admin);

    expect(await repo.getPersisted('tenant-a')).toBeNull();

    // `get()` sintetiza vacío, jamás las credenciales del vecino.
    const a = await repo.get('tenant-a');
    expect(a.openpayMerchantId).toBe('');
    expect(a.tenantId).toBe('tenant-a');
  });

  it('una fila legacy corrupta (id de A, tenant_id de B) NO se entrega a A', async () => {
    // Estado exacto que MT-03 describe: el `id` dice una cosa y la columna
    // canónica otra. Fail-closed: la autoridad es tenant_id.
    const { admin } = makeFakeAdmin([
      rowFor('tenant-b', 'tenant-a', { openpay_merchant_id: 'MERCHANT_B' }),
    ]);
    const repo = new SupabaseIntegrationsRepository(admin);

    expect(await repo.getPersisted('tenant-a')).toBeNull();
  });

  it('A no puede sobrescribir la fila de B por colisión de id', async () => {
    const { admin, table, calls } = makeFakeAdmin([
      rowFor('tenant-b', 'tenant-a', { openpay_merchant_id: 'MERCHANT_B' }),
    ]);
    const repo = new SupabaseIntegrationsRepository(admin);

    const rec = emptyIntegrationSettings();
    rec.openpayMerchantId = 'MERCHANT_A';
    await repo.save(rec, 'tenant-a');

    // El upsert resuelve por tenant_id: la fila de B queda intacta.
    expect(calls.onConflict).toBe('tenant_id');
    const b = table.find((r) => r.tenant_id === 'tenant-b');
    expect(b?.openpay_merchant_id).toBe('MERCHANT_B');
    const a = table.find((r) => r.tenant_id === 'tenant-a');
    expect(a?.openpay_merchant_id).toBe('MERCHANT_A');
  });

  it('el dueño del webhook OpenPay sale de tenant_id, no de id', async () => {
    // Divergencia sintética para fijar la fuente de autoridad: si el código
    // dedujera el tenant desde `id`, este caso devolvería 'tenant-default'.
    const { admin } = makeFakeAdmin([
      rowFor('tenant-b', 'default', { openpay_webhook_token: 'tok_b' }),
    ]);
    const repo = new SupabaseIntegrationsRepository(admin);

    const owner = await repo.findByOpenPayWebhookToken('tok_b');
    expect(owner?.tenantId).toBe('tenant-b');
  });

  it('rechaza una fila cuyo tenant_id no es el solicitado (defensa en profundidad)', async () => {
    // Si el filtro se rompiera o la DB devolviera otra fila, el repositorio no
    // la acepta en silencio.
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: rowFor('tenant-b', 'tenant-b'), error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const repo = new SupabaseIntegrationsRepository(admin);

    await expect(repo.getPersisted('tenant-a')).rejects.toThrow(/tenant/i);
  });
});

describe('MT-03 — el repositorio en memoria expone la misma identidad canónica', () => {
  it('el record del store lleva el tenant real', async () => {
    const { StoreIntegrationsRepository } = await import(
      '../../backend/domains/integrations/repository'
    );
    const repo = new StoreIntegrationsRepository();
    const saved = await repo.save(emptyIntegrationSettings(), 'tenant-b');
    expect(saved.tenantId).toBe('tenant-b');
    expect(saved.id).toBe('tenant-b');

    const def = await repo.save(emptyIntegrationSettings(), 'tenant-default');
    expect(def.tenantId).toBe('tenant-default');
    expect(def.id).toBe('default');
  });
});
