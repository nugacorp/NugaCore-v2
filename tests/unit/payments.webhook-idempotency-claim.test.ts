// ====================================================================
// Idempotencia de webhooks por CLAIM atómico (no check-then-insert).
//
// El patrón "buscar y si no existe insertar" tiene una ventana entre ambos
// pasos: dos entregas simultáneas del mismo evento pasaban las dos la
// comprobación y se procesaban las dos (doble reactivación, doble pago
// aplicado). El claim reserva el evento en una sola operación atómica.
//
// Un claim que no libera (crash a mitad del procesado) no puede bloquear el
// evento para siempre: pasado el lease, otra entrega puede reclamarlo — pero
// nunca mientras el lease del ganador siga vivo.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EVENT_CLAIM_LEASE_MS,
  StorePaymentRepository,
  SupabasePaymentRepository,
  classifyExistingClaim,
} from '../../backend/domains/payments/repository';
import type { PaymentEventRecord } from '../../backend/domains/payments/types';
import { store } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const repo = new StorePaymentRepository();

const candidate = (
  id: string,
  providerEventId: string,
  tenantId = TENANT_A,
): PaymentEventRecord => ({
  id,
  tenantId,
  provider: 'openpay',
  providerEventId,
  eventType: 'charge.succeeded',
  processed: false,
  payload: {},
  receivedAt: new Date().toISOString(),
});

const events = () => store.PAYMENT_EVENTS as PaymentEventRecord[];

beforeEach(() => { store.PAYMENT_EVENTS.length = 0; });
afterEach(() => { store.PAYMENT_EVENTS.length = 0; });

describe('Clasificación de un claim existente', () => {
  const now = Date.now();

  it('un evento ya procesado nunca se vuelve a procesar', () => {
    expect(classifyExistingClaim({ processed: true, claimedAt: undefined }, now))
      .toBe('already_processed');
    // Aunque su claim sea antiquísimo: processed manda.
    expect(classifyExistingClaim(
      { processed: true, claimedAt: new Date(now - 10 * EVENT_CLAIM_LEASE_MS).toISOString() },
      now,
    )).toBe('already_processed');
  });

  it('un claim reciente sigue en curso (nadie más puede tomarlo)', () => {
    const claimedAt = new Date(now - Math.floor(EVENT_CLAIM_LEASE_MS / 2)).toISOString();
    expect(classifyExistingClaim({ processed: false, claimedAt }, now)).toBe('in_progress');
  });

  it('un claim vencido es recuperable', () => {
    const claimedAt = new Date(now - EVENT_CLAIM_LEASE_MS - 1_000).toISOString();
    expect(classifyExistingClaim({ processed: false, claimedAt }, now)).toBe('reclaimable');
  });

  it('una fila sin claim (legacy o abandonada) es recuperable', () => {
    expect(classifyExistingClaim({ processed: false, claimedAt: undefined }, now)).toBe('reclaimable');
  });
});

describe('Claim atómico en memoria', () => {
  it('dos entregas simultáneas del mismo evento: solo una gana', async () => {
    const [first, second] = await Promise.all([
      repo.claimEvent(candidate('pe-1', 'evt-dup')),
      repo.claimEvent(candidate('pe-2', 'evt-dup')),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['claimed', 'in_progress']);
    // Un solo evento registrado, y ambas respuestas apuntan al mismo.
    expect(events()).toHaveLength(1);
    expect(first.event.id).toBe(second.event.id);
  });

  it('diez entregas simultáneas producen un único claim', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => repo.claimEvent(candidate(`pe-${i}`, 'evt-storm'))),
    );

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });

  it('el mismo providerEventId en otro WISP se reclama por separado', async () => {
    const a = await repo.claimEvent(candidate('pe-a', 'evt-1', TENANT_A));
    const b = await repo.claimEvent(candidate('pe-b', 'evt-1', TENANT_B));

    expect(a.outcome).toBe('claimed');
    expect(b.outcome).toBe('claimed');
    expect(events()).toHaveLength(2);
  });

  it('tras procesarlo, una reentrega responde already_processed', async () => {
    const first = await repo.claimEvent(candidate('pe-1', 'evt-ok'));
    await repo.markEventProcessed(first.event.id);

    const second = await repo.claimEvent(candidate('pe-2', 'evt-ok'));
    expect(second.outcome).toBe('already_processed');
    expect(events()).toHaveLength(1);
  });

  it('un claim abandonado se recupera pasado el lease, sin duplicar el evento', async () => {
    const first = await repo.claimEvent(candidate('pe-1', 'evt-crash'));
    expect(first.outcome).toBe('claimed');
    // Simula el crash del ganador: quedó reclamado y sin procesar.
    const stranded = events()[0];
    stranded.claimedAt = new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

    const retry = await repo.claimEvent(candidate('pe-2', 'evt-crash'));
    expect(retry.outcome).toBe('claimed');
    expect(retry.event.id).toBe(first.event.id);
    expect(events()).toHaveLength(1);
    // El lease se renueva: otra entrega inmediata ya no puede tomarlo.
    expect((await repo.claimEvent(candidate('pe-3', 'evt-crash'))).outcome).toBe('in_progress');
  });

  it('el reclaim no compite consigo mismo: solo uno recupera el claim vencido', async () => {
    await repo.claimEvent(candidate('pe-1', 'evt-race'));
    events()[0].claimedAt = new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

    const results = await Promise.all([
      repo.claimEvent(candidate('pe-2', 'evt-race')),
      repo.claimEvent(candidate('pe-3', 'evt-race')),
    ]);

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'in_progress')).toHaveLength(1);
    expect(events()).toHaveLength(1);
  });
});

// ── Claim contra Postgres ─────────────────────────────────────────────
//
// Doble mínimo de PostgREST: modela la unicidad
// (tenant_id, provider, provider_event_id) devolviendo 23505, y aplica los
// filtros del UPDATE tal cual, que es lo que hace del reclaim un CAS real.

type Row = Record<string, unknown>;

const fakeSupabase = (rows: Row[]): SupabaseClient => {
  const buildQuery = () => {
    const filters: { col: string; value: unknown; is: boolean }[] = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let patch: Row = {};
    let inserted: Row | null = null;

    const matches = (r: Row) =>
      filters.every((f) => (f.is ? (r[f.col] ?? null) === f.value : r[f.col] === f.value));

    const exec = async () => {
      if (mode === 'insert' && inserted) {
        const dup = rows.some(
          (r) =>
            r.tenant_id === inserted!.tenant_id &&
            r.provider === inserted!.provider &&
            r.provider_event_id === inserted!.provider_event_id,
        );
        if (dup) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        rows.push({ ...inserted });
        return { data: null, error: null };
      }
      if (mode === 'update') {
        const hit = rows.filter(matches);
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows.filter(matches), error: null };
    };

    const api = {
      select: () => api,
      insert: (row: Row) => { mode = 'insert'; inserted = row; return api; },
      update: (p: Row) => { mode = 'update'; patch = p; return api; },
      eq: (col: string, value: unknown) => { filters.push({ col, value, is: false }); return api; },
      is: (col: string, value: unknown) => { filters.push({ col, value, is: true }); return api; },
      limit: () => api,
      order: () => api,
      maybeSingle: async () => {
        const found = rows.filter(matches);
        return { data: found[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        exec().then(resolve, reject),
    };
    return api;
  };

  return { from: () => buildQuery() } as unknown as SupabaseClient;
};

describe('Claim atómico en Postgres', () => {
  const oldClaim = () => new Date(Date.now() - EVENT_CLAIM_LEASE_MS - 60_000).toISOString();

  it('el primer INSERT gana el claim', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));

    const res = await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    expect(res.outcome).toBe('claimed');
    expect(rows).toHaveLength(1);
    expect(rows[0].claimed_at).toBeTruthy();
  });

  it('la violación de unicidad con lease vivo devuelve in_progress', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    await pg.claimEvent(candidate('pe-1', 'evt-pg'));

    const second = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(second.outcome).toBe('in_progress');
    expect(rows).toHaveLength(1);
  });

  it('un evento ya procesado devuelve already_processed', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    const first = await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    await pg.markEventProcessed(first.event.id);

    const second = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(second.outcome).toBe('already_processed');
  });

  it('un claim vencido se recupera y renueva el lease', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    const first = await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    rows[0].claimed_at = oldClaim();

    const retry = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(retry.outcome).toBe('claimed');
    expect(retry.event.id).toBe(first.event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].claimed_at).not.toBe(oldClaim());
    // Con el lease renovado, la siguiente entrega vuelve a quedar fuera.
    expect((await pg.claimEvent(candidate('pe-3', 'evt-pg'))).outcome).toBe('in_progress');
  });

  it('una fila legacy sin claimed_at se recupera por el filtro IS NULL', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    rows[0].claimed_at = null;

    const retry = await pg.claimEvent(candidate('pe-2', 'evt-pg'));
    expect(retry.outcome).toBe('claimed');
    expect(rows[0].claimed_at).toBeTruthy();
  });

  it('dos reclaims del mismo claim vencido: el CAS deja pasar a uno solo', async () => {
    const rows: Row[] = [];
    const pg = new SupabasePaymentRepository(fakeSupabase(rows));
    await pg.claimEvent(candidate('pe-1', 'evt-pg'));
    rows[0].claimed_at = oldClaim();

    const results = await Promise.all([
      pg.claimEvent(candidate('pe-2', 'evt-pg')),
      pg.claimEvent(candidate('pe-3', 'evt-pg')),
    ]);

    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'in_progress')).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });
});
