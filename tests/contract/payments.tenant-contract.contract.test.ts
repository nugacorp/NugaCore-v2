// ====================================================================
// MT-04 — El contrato de pagos exige tenant en toda operación de negocio.
//
// El backend habla con Supabase por service role: RLS no acota nada, así que
// un `tenantId` opcional convertía cualquier list/get/update en una operación
// GLOBAL. Aquí se fija el contrato en tres capas:
//
//   1. COMPILACIÓN — las llamadas sin tenant no compilan (`@ts-expect-error`
//      falla el typecheck en cuanto alguien vuelva a hacerlas opcionales).
//   2. RUNTIME — un caller que evade los tipos (cast, JS) falla cerrado en
//      vez de degradar a consulta global.
//   3. AISLAMIENTO A/B — desde A nunca se lee ni se modifica nada de B, ni en
//      el store en memoria ni contra PostgREST.
//
// No existe ningún método de plataforma que cruce WISPs; el último bloque lo
// congela para que añadir uno sea una decisión explícita, no un descuido.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  StorePaymentRepository,
  SupabasePaymentRepository,
} from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import type {
  MikrotikActionRecord,
  PaymentEventRecord,
  PaymentOrderRecord,
  TenantOwned,
} from '../../backend/domains/payments/types';
import { store } from '../../backend/state/store';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const NO_TENANT = /tenantId es obligatorio/;

const reset = () => {
  store.PAYMENT_ORDERS.length = 0;
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ACTIONS.length = 0;
};

beforeEach(reset);
afterEach(reset);

// ── Fixtures ──────────────────────────────────────────────────────────

const orderOf = (tenantId: string, id: string): TenantOwned<PaymentOrderRecord> => ({
  id,
  tenantId,
  customerId: `c-${tenantId}`,
  invoiceId: `fac-${tenantId}`,
  provider: 'openpay',
  providerOrderId: `chg-${id}`,
  amountCents: 29900,
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const actionOf = (tenantId: string, id: string): TenantOwned<MikrotikActionRecord> => ({
  id,
  tenantId,
  customerId: `c-${tenantId}`,
  actionType: 'reactivate',
  status: 'pending',
  dryRun: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const eventOf = (tenantId: string, id: string): TenantOwned<PaymentEventRecord> => ({
  id,
  tenantId,
  provider: 'openpay',
  providerEventId: `evt-${id}`,
  eventType: 'charge.succeeded',
  processed: false,
  payload: {},
  receivedAt: new Date().toISOString(),
});

// ── 1 + 2. El contrato no tiene variante global ───────────────────────

describe('MT-04 — la llamada de negocio sin tenant no compila', () => {
  const repo = new StorePaymentRepository();
  const service = new PaymentService(repo);

  // Este cuerpo NO se ejecuta: su valor es que `tsc --noEmit` lo compile.
  // Cada `@ts-expect-error` es la aserción RED — si alguien vuelve a hacer
  // opcional el tenant, la línea pasa a compilar, la directiva queda sin usar
  // y el typecheck falla con "Unused '@ts-expect-error' directive".
  const llamadasQueNoDebenCompilar = async (): Promise<void> => {
    // @ts-expect-error MT-04: listOrders no admite filtro sin tenantId.
    await repo.listOrders({ customerId: 'c-1' });
    // @ts-expect-error MT-04: findOrderById exige el WISP dueño.
    await repo.findOrderById('po-1');
    // @ts-expect-error MT-04: la búsqueda por id de proveedor exige el WISP.
    await repo.findOrderByProviderOrderId('openpay', 'chg-1');
    // @ts-expect-error MT-04: no existe update de order sin WISP.
    await repo.updateOrderStatus('po-1', 'completed');
    // @ts-expect-error MT-04-F1: el patch no puede trasplantar ownership.
    await repo.updateOrderStatus('po-1', TENANT_A, 'completed', { tenantId: TENANT_B });
    // @ts-expect-error MT-04-F1: el patch no puede cambiar la identidad.
    await repo.updateOrderStatus('po-1', TENANT_A, 'completed', { id: 'po-otra' });
    // @ts-expect-error MT-04: no se puede insertar una order sin WISP.
    await repo.createOrder({ ...orderOf(TENANT_A, 'po-1'), tenantId: undefined });
    // @ts-expect-error MT-04: listActions no admite filtro sin tenantId.
    await repo.listActions({ status: 'pending' });
    // @ts-expect-error MT-04: findActionById exige el WISP dueño.
    await repo.findActionById('ma-1');
    // @ts-expect-error MT-04: no existe update de acción sin WISP.
    await repo.updateAction('ma-1', { status: 'completed' });
    // @ts-expect-error MT-04-F1: el patch no puede trasplantar ownership.
    await repo.updateAction('ma-1', TENANT_A, { tenantId: TENANT_B });
    // @ts-expect-error MT-04-F1: el patch no puede cambiar la identidad.
    await repo.updateAction('ma-1', TENANT_A, { id: 'ma-otra' });
    // @ts-expect-error MT-04: el claim exige el WISP del evento.
    await repo.claimEvent({ ...eventOf(TENANT_A, 'pe-1'), tenantId: undefined });
    // @ts-expect-error MT-04: renovar el lease exige el WISP del evento.
    await repo.renewEventClaim('pe-1', 'token');
    // @ts-expect-error MT-04: cerrar el evento exige el WISP del evento.
    await repo.markEventProcessed('pe-1', 'token');
    // @ts-expect-error MT-04: listOrders del servicio exige tenantId.
    await service.listOrders({ customerId: 'c-1' });
    // @ts-expect-error MT-04: getOrder del servicio exige tenantId.
    await service.getOrder('po-1');
    // @ts-expect-error MT-04: listActions del servicio exige tenantId.
    await service.listActions({});
    // @ts-expect-error MT-04: getAction del servicio exige tenantId.
    await service.getAction('ma-1');
    // @ts-expect-error MT-04: reactivar exige contexto con tenantId.
    await service.reactivateCustomerService('c-1');
    // @ts-expect-error MT-04: crear order exige tenantId en el input.
    await service.createOrder({
      customerId: 'c-1', invoiceId: 'fac-1', provider: 'manual', amountCents: 100,
    });
  };

  it('el bloque de llamadas prohibidas existe y sólo pasa el typecheck por las directivas', () => {
    // Nunca se invoca: ejecutarlo escribiría en el store. La prueba la hace
    // el compilador; esta aserción sólo evita que el bloque quede huérfano.
    expect(typeof llamadasQueNoDebenCompilar).toBe('function');
  });
});

describe('MT-04 — un tenant ausente o vacío falla cerrado, nunca degrada a global', () => {
  const repo = new StorePaymentRepository();
  const service = new PaymentService(repo);

  // El compilador cubre al caller tipado. Este bloque cubre al que lo evade
  // (cast, capa sin tipar, JS): el tenant llega vacío o `undefined` y la
  // operación revienta en vez de convertirse en una consulta global.
  const sinTenant = undefined as unknown as string;

  it('el repositorio rechaza tenant ausente o en blanco', async () => {
    await expect(repo.listOrders({ tenantId: sinTenant })).rejects.toThrow(NO_TENANT);
    await expect(repo.listOrders({ tenantId: '   ' })).rejects.toThrow(NO_TENANT);
    await expect(repo.findOrderById('po-1', '')).rejects.toThrow(NO_TENANT);
    await expect(repo.findOrderByProviderOrderId('openpay', 'chg-1', sinTenant)).rejects.toThrow(NO_TENANT);
    await expect(repo.updateOrderStatus('po-1', sinTenant, 'completed')).rejects.toThrow(NO_TENANT);
    await expect(repo.listActions({ tenantId: '' })).rejects.toThrow(NO_TENANT);
    await expect(repo.findActionById('ma-1', sinTenant)).rejects.toThrow(NO_TENANT);
    await expect(repo.updateAction('ma-1', '  ', { status: 'completed' })).rejects.toThrow(NO_TENANT);
    await expect(repo.renewEventClaim('pe-1', sinTenant, 'token')).rejects.toThrow(NO_TENANT);
    await expect(repo.markEventProcessed('pe-1', '', 'token')).rejects.toThrow(NO_TENANT);
    await expect(repo.findEventByProviderId('openpay', 'evt-1', sinTenant)).rejects.toThrow(NO_TENANT);
  });

  it('las escrituras rechazan un registro sin WISP', async () => {
    const orden = { ...orderOf(TENANT_A, 'po-huérfana'), tenantId: sinTenant };
    const accion = { ...actionOf(TENANT_A, 'ma-huérfana'), tenantId: sinTenant };
    const evento = { ...eventOf(TENANT_A, 'pe-huérfano'), tenantId: sinTenant };

    await expect(repo.createOrder(orden)).rejects.toThrow(NO_TENANT);
    await expect(repo.createAction(accion)).rejects.toThrow(NO_TENANT);
    await expect(repo.createEvent(evento)).rejects.toThrow(NO_TENANT);
    await expect(repo.claimEvent(evento)).rejects.toThrow(NO_TENANT);

    // Y nada quedó escrito con un dueño inventado.
    expect(store.PAYMENT_ORDERS).toHaveLength(0);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.PAYMENT_EVENTS).toHaveLength(0);
  });

  it('el servicio rechaza tenant ausente o en blanco', async () => {
    await expect(service.listOrders({ tenantId: sinTenant })).rejects.toThrow(NO_TENANT);
    await expect(service.getOrder('po-1', '')).rejects.toThrow(NO_TENANT);
    await expect(service.listActions({ tenantId: '   ' })).rejects.toThrow(NO_TENANT);
    await expect(service.getAction('ma-1', sinTenant)).rejects.toThrow(NO_TENANT);
    await expect(service.reactivateCustomerService('c-1', { tenantId: sinTenant }))
      .rejects.toThrow(NO_TENANT);
    await expect(service.createOrder({
      customerId: 'c-1', invoiceId: 'fac-1', provider: 'manual', amountCents: 100, tenantId: '',
    })).rejects.toThrow(NO_TENANT);
  });
});

// ── 3a. Aislamiento A/B en el store en memoria ────────────────────────

describe('MT-04 — aislamiento A/B (store en memoria)', () => {
  const repo = new StorePaymentRepository();

  const seedBoth = async () => {
    await repo.createOrder(orderOf(TENANT_A, 'po-a'));
    await repo.createOrder(orderOf(TENANT_B, 'po-b'));
    await repo.createAction(actionOf(TENANT_A, 'ma-a'));
    await repo.createAction(actionOf(TENANT_B, 'ma-b'));
  };

  it('list sólo devuelve lo del WISP consultado', async () => {
    await seedBoth();

    expect((await repo.listOrders({ tenantId: TENANT_A })).map((o) => o.id)).toEqual(['po-a']);
    expect((await repo.listOrders({ tenantId: TENANT_B })).map((o) => o.id)).toEqual(['po-b']);
    expect((await repo.listActions({ tenantId: TENANT_A })).map((a) => a.id)).toEqual(['ma-a']);
    expect((await repo.listActions({ tenantId: TENANT_B })).map((a) => a.id)).toEqual(['ma-b']);
  });

  it('get de un id ajeno devuelve null aunque el id exista', async () => {
    await seedBoth();

    expect(await repo.findOrderById('po-b', TENANT_A)).toBeNull();
    expect(await repo.findOrderById('po-b', TENANT_B)).not.toBeNull();
    expect(await repo.findActionById('ma-b', TENANT_A)).toBeNull();
    expect(await repo.findActionById('ma-b', TENANT_B)).not.toBeNull();
  });

  it('update de un id ajeno no devuelve nada y NO muta el registro de B', async () => {
    await seedBoth();

    expect(await repo.updateOrderStatus('po-b', TENANT_A, 'completed')).toBeNull();
    expect(await repo.updateAction('ma-b', TENANT_A, { status: 'completed' })).toBeNull();

    const ordenB = (await repo.listOrders({ tenantId: TENANT_B }))[0];
    const accionB = (await repo.listActions({ tenantId: TENANT_B }))[0];
    expect(ordenB.status).toBe('pending');
    expect(accionB.status).toBe('pending');

    // Y el dueño legítimo sí puede.
    expect((await repo.updateOrderStatus('po-b', TENANT_B, 'completed'))?.status).toBe('completed');
  });

  it('un patch untyped no cambia id/tenantId y sólo aplica la allowlist', async () => {
    await seedBoth();

    await (repo.updateOrderStatus as unknown as (
      id: string, tenantId: string, status: 'completed', patch: Record<string, unknown>,
    ) => Promise<unknown>)('po-a', TENANT_A, 'completed', {
      id: 'po-trasplantada',
      tenantId: TENANT_B,
      providerOrderId: 'chg-actualizado',
      checkoutUrl: 'https://checkout.invalid/a',
      invoiceId: 'fac-prohibida',
    });
    await (repo.updateAction as unknown as (
      id: string, tenantId: string, patch: Record<string, unknown>,
    ) => Promise<unknown>)('ma-a', TENANT_A, {
      id: 'ma-trasplantada',
      tenantId: TENANT_B,
      status: 'completed',
      result: { accepted: true },
      customerId: 'c-prohibido',
    });

    const orderA = await repo.findOrderById('po-a', TENANT_A);
    const actionA = await repo.findActionById('ma-a', TENANT_A);
    expect(orderA).toMatchObject({
      id: 'po-a', tenantId: TENANT_A, invoiceId: `fac-${TENANT_A}`,
      status: 'completed', providerOrderId: 'chg-actualizado',
      checkoutUrl: 'https://checkout.invalid/a',
    });
    expect(actionA).toMatchObject({
      id: 'ma-a', tenantId: TENANT_A, customerId: `c-${TENANT_A}`,
      status: 'completed', result: { accepted: true },
    });
    expect(await repo.listOrders({ tenantId: TENANT_B })).not.toContainEqual(
      expect.objectContaining({ id: 'po-a' }),
    );
    expect(await repo.listActions({ tenantId: TENANT_B })).not.toContainEqual(
      expect.objectContaining({ id: 'ma-a' }),
    );
  });

  it('el claim de B no se renueva ni se cierra desde A', async () => {
    const claim = await repo.claimEvent(eventOf(TENANT_B, 'pe-b'));
    const token = claim.event.claimToken!;

    expect(await repo.renewEventClaim('pe-b', TENANT_A, token)).toBe(false);
    expect(await repo.markEventProcessed('pe-b', TENANT_A, token)).toBe(false);
    expect((store.PAYMENT_EVENTS as PaymentEventRecord[])[0].processed).toBe(false);

    expect(await repo.renewEventClaim('pe-b', TENANT_B, token)).toBe(true);
    expect(await repo.markEventProcessed('pe-b', TENANT_B, token)).toBe(true);
  });
});

// ── 3b. Aislamiento A/B contra PostgREST (service role) ───────────────
//
// Doble mínimo de PostgREST que además REGISTRA cada consulta: lo que se
// verifica no es sólo el resultado, sino que ninguna consulta llegue a la base
// sin `tenant_id` en el predicado — que es justo lo que RLS no va a impedir.

type Row = Record<string, unknown>;

interface RecordedQuery {
  table: string;
  mode: 'select' | 'insert' | 'update';
  tenantId: unknown;
}

const recordingSupabase = (tables: Record<string, Row[]>, log: RecordedQuery[]): SupabaseClient => {
  const from = (table: string) => {
    const filters: { col: string; value: unknown }[] = [];
    let mode: 'select' | 'insert' | 'update' = 'select';
    let patch: Row = {};
    let inserted: Row | null = null;

    const rows = () => (tables[table] ??= []);
    const matches = (r: Row) => filters.every((f) => r[f.col] === f.value);
    const record = () => {
      const filtered = filters.find((f) => f.col === 'tenant_id')?.value;
      log.push({ table, mode, tenantId: filtered ?? inserted?.tenant_id });
    };

    const exec = async () => {
      record();
      if (mode === 'insert' && inserted) {
        rows().push({ ...inserted });
        return { data: null, error: null };
      }
      if (mode === 'update') {
        const hit = rows().filter(matches);
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      return { data: rows().filter(matches), error: null };
    };

    const api = {
      select: () => api,
      insert: (row: Row) => { mode = 'insert'; inserted = row; return api; },
      update: (p: Row) => { mode = 'update'; patch = p; return api; },
      eq: (col: string, value: unknown) => { filters.push({ col, value }); return api; },
      is: (col: string, value: unknown) => { filters.push({ col, value: value ?? null }); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => {
        record();
        return { data: rows().filter(matches)[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        exec().then(resolve, reject),
    };
    return api;
  };

  return { from } as unknown as SupabaseClient;
};

describe('MT-04 — aislamiento A/B contra PostgREST con service role', () => {
  const build = () => {
    const log: RecordedQuery[] = [];
    const tables: Record<string, Row[]> = {
      payment_orders: [
        { id: 'po-a', tenant_id: TENANT_A, customer_id: 'c-a', invoice_id: 'fac-a', provider: 'openpay', provider_order_id: 'chg-a', amount_cents: 100, status: 'pending' },
        { id: 'po-b', tenant_id: TENANT_B, customer_id: 'c-b', invoice_id: 'fac-b', provider: 'openpay', provider_order_id: 'chg-b', amount_cents: 100, status: 'pending' },
      ],
      mikrotik_actions: [
        { id: 'ma-a', tenant_id: TENANT_A, customer_id: 'c-a', action_type: 'reactivate', status: 'pending', dry_run: true },
        { id: 'ma-b', tenant_id: TENANT_B, customer_id: 'c-b', action_type: 'reactivate', status: 'pending', dry_run: true },
      ],
      payment_events: [
        { id: 'pe-b', tenant_id: TENANT_B, provider: 'openpay', provider_event_id: 'evt-b', event_type: 'charge.succeeded', processed: false, payload: {}, claim_token: 'token-b' },
      ],
    };
    return { repo: new SupabasePaymentRepository(recordingSupabase(tables, log)), tables, log };
  };

  it('A no lee las filas de B en ninguna tabla', async () => {
    const { repo } = build();

    expect((await repo.listOrders({ tenantId: TENANT_A })).map((o) => o.id)).toEqual(['po-a']);
    expect(await repo.findOrderById('po-b', TENANT_A)).toBeNull();
    expect(await repo.findOrderByProviderOrderId('openpay', 'chg-b', TENANT_A)).toBeNull();
    expect((await repo.listActions({ tenantId: TENANT_A })).map((a) => a.id)).toEqual(['ma-a']);
    expect(await repo.findActionById('ma-b', TENANT_A)).toBeNull();
    expect(await repo.findEventByProviderId('openpay', 'evt-b', TENANT_A)).toBeNull();
  });

  it('A no modifica las filas de B: el UPDATE lleva el tenant en el predicado', async () => {
    const { repo, tables } = build();

    expect(await repo.updateOrderStatus('po-b', TENANT_A, 'completed')).toBeNull();
    expect(await repo.updateAction('ma-b', TENANT_A, { status: 'completed' })).toBeNull();
    expect(await repo.renewEventClaim('pe-b', TENANT_A, 'token-b')).toBe(false);
    expect(await repo.markEventProcessed('pe-b', TENANT_A, 'token-b')).toBe(false);

    expect(tables.payment_orders.find((r) => r.id === 'po-b')?.status).toBe('pending');
    expect(tables.mikrotik_actions.find((r) => r.id === 'ma-b')?.status).toBe('pending');
    expect(tables.payment_events.find((r) => r.id === 'pe-b')?.processed).toBe(false);
  });

  it('B sí opera sobre lo suyo (el aislamiento no es un "no hace nada")', async () => {
    const { repo, tables } = build();

    expect((await repo.updateOrderStatus('po-b', TENANT_B, 'completed'))?.status).toBe('completed');
    expect((await repo.updateAction('ma-b', TENANT_B, { status: 'completed' }))?.status).toBe('completed');
    expect(await repo.markEventProcessed('pe-b', TENANT_B, 'token-b')).toBe(true);
    expect(tables.payment_events.find((r) => r.id === 'pe-b')?.processed).toBe(true);
  });

  it('Supabase aplica la misma allowlist ante un patch untyped', async () => {
    const { repo, tables } = build();

    await (repo.updateOrderStatus as unknown as (
      id: string, tenantId: string, status: 'completed', patch: Record<string, unknown>,
    ) => Promise<unknown>)('po-a', TENANT_A, 'completed', {
      id: 'po-trasplantada', tenantId: TENANT_B,
      providerOrderId: 'chg-actualizado', checkoutUrl: 'https://checkout.invalid/a',
      invoiceId: 'fac-prohibida',
    });
    await (repo.updateAction as unknown as (
      id: string, tenantId: string, patch: Record<string, unknown>,
    ) => Promise<unknown>)('ma-a', TENANT_A, {
      id: 'ma-trasplantada', tenantId: TENANT_B,
      status: 'completed', result: { accepted: true }, customerId: 'c-prohibido',
    });

    expect(tables.payment_orders.find((r) => r.id === 'po-a')).toMatchObject({
      id: 'po-a', tenant_id: TENANT_A, invoice_id: 'fac-a',
      status: 'completed', provider_order_id: 'chg-actualizado',
      checkout_url: 'https://checkout.invalid/a',
    });
    expect(tables.mikrotik_actions.find((r) => r.id === 'ma-a')).toMatchObject({
      id: 'ma-a', tenant_id: TENANT_A, customer_id: 'c-a',
      status: 'completed', result: { accepted: true },
    });
  });

  it('ninguna consulta llega a la base sin tenant_id', async () => {
    const { repo, log } = build();

    await repo.listOrders({ tenantId: TENANT_A });
    await repo.findOrderById('po-a', TENANT_A);
    await repo.findOrderByProviderOrderId('openpay', 'chg-a', TENANT_A);
    await repo.createOrder(orderOf(TENANT_A, 'po-nueva'));
    await repo.updateOrderStatus('po-a', TENANT_A, 'completed');
    await repo.listActions({ tenantId: TENANT_A });
    await repo.findActionById('ma-a', TENANT_A);
    await repo.createAction(actionOf(TENANT_A, 'ma-nueva'));
    await repo.updateAction('ma-a', TENANT_A, { status: 'completed' });
    await repo.createEvent(eventOf(TENANT_A, 'pe-nuevo'));
    await repo.findEventByProviderId('openpay', 'evt-pe-nuevo', TENANT_A);
    await repo.renewEventClaim('pe-nuevo', TENANT_A, 'token');
    await repo.markEventProcessed('pe-nuevo', TENANT_A, 'token');

    expect(log.length).toBeGreaterThan(0);
    expect(log.filter((q) => q.tenantId !== TENANT_A)).toEqual([]);
  });
});

// ── 4. Aislamiento A/B en la capa de servicio ─────────────────────────

describe('MT-04 — aislamiento A/B en PaymentService', () => {
  const service = new PaymentService(new StorePaymentRepository());
  const repo = new StorePaymentRepository();

  beforeEach(async () => {
    await repo.createOrder(orderOf(TENANT_A, 'po-a'));
    await repo.createOrder(orderOf(TENANT_B, 'po-b'));
    await repo.createAction(actionOf(TENANT_A, 'ma-a'));
    await repo.createAction(actionOf(TENANT_B, 'ma-b'));
  });

  it('lo que ve A y lo que ve B son conjuntos disjuntos', async () => {
    const vistaA = await service.listOrders({ tenantId: TENANT_A });
    const vistaB = await service.listOrders({ tenantId: TENANT_B });

    expect(vistaA.map((o) => o.id)).toEqual(['po-a']);
    expect(vistaB.map((o) => o.id)).toEqual(['po-b']);
    expect((await service.listActions({ tenantId: TENANT_A })).map((a) => a.id)).toEqual(['ma-a']);
    expect((await service.listActions({ tenantId: TENANT_B })).map((a) => a.id)).toEqual(['ma-b']);
  });

  it('A pidiendo el id de B recibe null (la ruta lo traduce a 404)', async () => {
    expect(await service.getOrder('po-b', TENANT_A)).toBeNull();
    expect(await service.getAction('ma-b', TENANT_A)).toBeNull();

    expect((await service.getOrder('po-b', TENANT_B))?.id).toBe('po-b');
    expect((await service.getAction('ma-b', TENANT_B))?.id).toBe('ma-b');
  });
});

// ── 5. Superficie global ──────────────────────────────────────────────

describe('MT-04 — no existe operación de plataforma que cruce WISPs', () => {
  it('el contrato del repositorio se limita a los métodos acotados por tenant', () => {
    const metodos = Object.getOwnPropertyNames(StorePaymentRepository.prototype)
      .filter((name) => name !== 'constructor')
      .sort();

    // Si este listado cambia, la operación nueva debe justificarse: cualquier
    // necesidad global de plataforma va como método aparte con nombre
    // inequívoco, rol de plataforma, auditoría y sus propios tests — nunca
    // reintroduciendo `tenantId` opcional en éstos.
    expect(metodos).toEqual([
      'checkpointReactivationStep',
      'claimEvent',
      'createAction',
      'createActionIdempotent',
      'createEvent',
      'createOrder',
      'findActionById',
      'findActionByIdempotencyKey',
      'findEventByProviderId',
      'findOrderById',
      'findOrderByProviderOrderId',
      'listActions',
      'listOrders',
      'markEventProcessed',
      'nextActionId',
      'nextEventId',
      'nextOrderId',
      'renewEventClaim',
      'updateAction',
      'updateOrderStatus',
    ]);
  });

  it('ambas implementaciones exponen exactamente el mismo contrato', () => {
    const nombres = (proto: object) =>
      Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor').sort();

    expect(nombres(SupabasePaymentRepository.prototype))
      .toEqual([...nombres(StorePaymentRepository.prototype), 'eventRow'].sort());
  });
});
