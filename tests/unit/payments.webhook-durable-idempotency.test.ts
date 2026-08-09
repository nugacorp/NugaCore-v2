// ====================================================================
// T5 — idempotencia durable por efecto.
//
// La revisión concurrente demostró que un checkpoint sobre `result` no basta:
// dos owners vivos podían duplicar el efecto antes del checkpoint y el write
// tardío del owner vencido podía borrar el progreso del nuevo. El contrato
// aprobado cierra eso con tres piezas que se prueban aquí:
//
//   1. la propia acción es el primer destino idempotente (create-or-return),
//      así A y B derivan la MISMA familia de claves `actionId + step`;
//   2. cada destino acepta esa clave y hace insert-or-return-existing, así el
//      reintento de B recupera la fila de A en vez de crear otra;
//   3. el checkpoint es una operación set-only condicionada al claim vigente,
//      así el owner vencido no puede escribir y nadie pierde progreso.
//
// Store y Supabase deben cumplir la MISMA matriz: el doble de PostgREST
// reproduce los índices únicos parciales y las RPC de la migración.
// ====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IdempotencyConflictError,
  IdempotencyResolutionError,
} from '../../backend/common/errors';
import {
  StorePaymentRepository,
  SupabasePaymentRepository,
} from '../../backend/domains/payments/repository';
import {
  rootActionIdempotencyKey,
  stepIdempotencyKey,
  webhookPaymentIdempotencyKey,
} from '../../backend/domains/payments/idempotency';
import {
  evaluateWebhookCapability,
} from '../../backend/domains/payments/webhook-capability';
import { PaymentService } from '../../backend/domains/payments/service';
import type {
  MikrotikActionRecord,
  PaymentEventRecord,
  TenantOwned,
} from '../../backend/domains/payments/types';
import {
  StoreBillingRepository,
  SupabaseBillingRepository,
} from '../../backend/domains/billing/repository';
import {
  StoreCustomersRepository,
  SupabaseCustomersRepository,
} from '../../backend/domains/customers/repository';
import {
  StoreSuspensionRepository,
  SupabaseSuspensionRepository,
} from '../../backend/domains/suspension/repository';
import { StoreAlertSink, SupabaseAlertSink } from '../../backend/domains/noc/alert-sink';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store } from '../../backend/state/store';
import { asSupabaseClient, FakePostgrest } from '../helpers/fake-postgrest';
import {
  CAPABILITY_RPC,
  CHECKPOINT_RPC,
  registerWebhookRpcs,
  registerWebhookUniqueIndexes,
} from '../helpers/webhook-rpc-simulator';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const PREFIX = 'customer-durable-idem-';

const EVENT_ID = 'pe-durable-1';
const OTHER_EVENT_ID = 'pe-durable-2';

// ── Utilidades comunes ────────────────────────────────────────────────

const claimedEvent = (
  id = EVENT_ID,
  tenantId = TENANT_A,
  claimToken = 'owner-a',
): TenantOwned<PaymentEventRecord> => ({
  id,
  tenantId,
  provider: 'openpay',
  providerEventId: `evt-${id}`,
  eventType: 'charge.succeeded',
  processed: false,
  payload: {},
  receivedAt: new Date().toISOString(),
  claimedAt: new Date().toISOString(),
  claimToken,
  webhookPaymentId: `payment:${id}`,
});

const rootAction = (
  overrides: Partial<MikrotikActionRecord> = {},
): TenantOwned<MikrotikActionRecord> => {
  const customerId = overrides.customerId ?? `${PREFIX}root`;
  const paymentEventId = overrides.paymentEventId ?? EVENT_ID;
  const webhookPaymentId = overrides.webhookPaymentId ?? `payment:${paymentEventId}`;
  const tenantId = overrides.tenantId ?? TENANT_A;
  return {
    id: 'ma-candidate-a',
    tenantId,
    customerId,
    actionType: 'reactivate',
    status: 'pending',
    dryRun: true,
    paymentEventId,
    webhookPaymentId,
    idempotencyKey: rootActionIdempotencyKey(webhookPaymentId, customerId),
    payload: { previousStatus: 'suspended', reason: 'payment_confirmed' },
    triggeredBy: 'webhook:openpay:evt-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
};

const supabaseWorld = () => {
  const db = new FakePostgrest();
  registerWebhookUniqueIndexes(db);
  registerWebhookRpcs(db);
  return db;
};

const seedClaim = (db: FakePostgrest, event = claimedEvent()) => {
  db.seed('payment_events', [{
    id: event.id,
    tenant_id: event.tenantId,
    provider: event.provider,
    provider_event_id: event.providerEventId,
    event_type: event.eventType,
    processed: event.processed,
    payload: event.payload,
    received_at: event.receivedAt,
    claimed_at: event.claimedAt,
    claim_token: event.claimToken,
    webhook_payment_id: event.webhookPaymentId,
  }]);
  return event;
};

beforeEach(() => {
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ACTIONS = [];
});

afterEach(() => {
  store.PAYMENT_EVENTS.length = 0;
  store.MIKROTIK_ACTIONS = store.MIKROTIK_ACTIONS.filter((a) => !a.customerId.startsWith(PREFIX));
  store.CLIENT_TIMELINE = store.CLIENT_TIMELINE.filter((e) => !e.clientId.startsWith(PREFIX));
  store.NOC_ALERTS = store.NOC_ALERTS.filter((a) => !a.source.startsWith(PREFIX));
  store.PAYMENT_ALLOCATIONS = store.PAYMENT_ALLOCATIONS.filter((a) => !a.invoiceId.startsWith('INV-DURABLE'));
  store.INVOICES = store.INVOICES.filter((i) => !i.id.startsWith('INV-DURABLE'));
  engineStore.EVENTS = engineStore.EVENTS.filter((e) => !e.customerId.startsWith(PREFIX));
  engineStore.ORDERS = engineStore.ORDERS.filter((o) => !o.customerId.startsWith(PREFIX));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════
// 1. Raíz idempotente: la acción es el primer destino create-or-return
// ════════════════════════════════════════════════════════════════════

describe('Acción raíz create-or-return por tenant + payment event', () => {
  it('Store: dos owners con la misma identidad reciben el MISMO actionId', async () => {
    const repo = new StorePaymentRepository();
    const a = await repo.createActionIdempotent(rootAction({ id: 'ma-candidate-a' }));
    const b = await repo.createActionIdempotent(rootAction({ id: 'ma-candidate-b' }));

    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('existing');
    expect(b.action.id).toBe(a.action.id);
    expect(store.MIKROTIK_ACTIONS.filter((x) => x.customerId.startsWith(PREFIX))).toHaveLength(1);
  });

  it('Store: la misma key con payload distinto falla cerrado como conflicto', async () => {
    const repo = new StorePaymentRepository();
    await repo.createActionIdempotent(rootAction());

    await expect(
      repo.createActionIdempotent(rootAction({
        id: 'ma-candidate-b',
        payload: { previousStatus: 'active', reason: 'different-effect' },
      })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Store: eventos y tenants distintos no comparten identidad', async () => {
    const repo = new StorePaymentRepository();
    const first = await repo.createActionIdempotent(rootAction());
    const otherEvent = await repo.createActionIdempotent(
      rootAction({ id: 'ma-candidate-b', paymentEventId: OTHER_EVENT_ID }),
    );
    const otherTenant = await repo.createActionIdempotent(
      rootAction({ id: 'ma-candidate-c', tenantId: TENANT_B }),
    );

    expect(new Set([first.action.id, otherEvent.action.id, otherTenant.action.id]).size).toBe(3);
  });

  it('Store: no comparte referencias mutables con quien lee la acción', async () => {
    const repo = new StorePaymentRepository();
    const created = await repo.createActionIdempotent(rootAction());
    (created.action.result ??= {}).intruso = true;

    const [persisted] = await repo.listActions({ tenantId: TENANT_A, customerId: `${PREFIX}root` });
    expect(persisted.result?.intruso).toBeUndefined();
  });

  it('Store: la acción manual conserva key y payment event nulos', async () => {
    const repo = new StorePaymentRepository();
    await repo.createAction({
      id: 'ma-manual',
      tenantId: TENANT_A,
      customerId: `${PREFIX}manual`,
      actionType: 'reactivate',
      status: 'pending',
      dryRun: true,
      triggeredBy: 'operator',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const [manual] = await repo.listActions({ tenantId: TENANT_A, customerId: `${PREFIX}manual` });
    expect(manual.idempotencyKey).toBeUndefined();
    expect(manual.paymentEventId).toBeUndefined();
  });

  it('Supabase: el índice único parcial convierte la colisión en create-or-return', async () => {
    const db = supabaseWorld();
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));

    const a = await repo.createActionIdempotent(rootAction({ id: 'ma-candidate-a' }));
    const b = await repo.createActionIdempotent(rootAction({ id: 'ma-candidate-b' }));

    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('existing');
    expect(b.action.id).toBe('ma-candidate-a');
    expect(db.rows('mikrotik_actions')).toHaveLength(1);
  });

  it('Supabase: colisión con payload divergente es conflicto, no `existing`', async () => {
    const db = supabaseWorld();
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));
    await repo.createActionIdempotent(rootAction());

    await expect(
      repo.createActionIdempotent(rootAction({ id: 'ma-candidate-b', customerId: `${PREFIX}root`, dryRun: false })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Supabase: unique sin fila visible falla retryable sin exponer la key', async () => {
    const db = supabaseWorld();
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));
    const first = rootAction();
    await repo.createActionIdempotent(first);
    db.hideNextRead('mikrotik_actions');

    const error = await repo.createActionIdempotent(rootAction({ id: 'ma-candidate-hidden' }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IdempotencyResolutionError);
    expect((error as Error).message).not.toContain(first.idempotencyKey!);
    expect(error).toMatchObject({
      scope: 'mikrotik_actions',
      fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
    });
  });

  it('Store/Supabase: payloads JSON semánticamente iguales no producen falso conflicto', async () => {
    const first = rootAction({
      payload: { reason: 'payment_confirmed', nested: { b: 2, a: 1 } },
    });
    const equivalent = rootAction({
      id: 'ma-candidate-b',
      payload: { nested: { a: 1, b: 2 }, reason: 'payment_confirmed' },
    });

    const storeRepo = new StorePaymentRepository();
    await storeRepo.createActionIdempotent(first);
    await expect(storeRepo.createActionIdempotent(equivalent)).resolves.toMatchObject({ outcome: 'existing' });

    store.MIKROTIK_ACTIONS = [];
    const db = supabaseWorld();
    const dbRepo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));
    await dbRepo.createActionIdempotent(first);
    await expect(dbRepo.createActionIdempotent(equivalent)).resolves.toMatchObject({ outcome: 'existing' });
  });

  it('Store: la acción durable no comparte referencias JSON con input ni resultados', async () => {
    const repo = new StorePaymentRepository();
    const input = rootAction({ payload: { nested: { value: 'original' } } });
    const created = await repo.createActionIdempotent(input);

    (input.payload!.nested as Record<string, unknown>).value = 'mutated-input';
    (created.action.payload!.nested as Record<string, unknown>).value = 'mutated-result';

    const persisted = await repo.findActionByIdempotencyKey(TENANT_A, input.idempotencyKey!);
    expect(persisted?.payload).toEqual({ nested: { value: 'original' } });
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Checkpoint set-only condicionado al claim
// ════════════════════════════════════════════════════════════════════

describe('Checkpoint set-only condicionado al claim vigente', () => {
  const seedStoreWorld = async () => {
    const repo = new StorePaymentRepository();
    store.PAYMENT_EVENTS.push(claimedEvent());
    const { action } = await repo.createActionIdempotent(rootAction());
    return { repo, actionId: action.id };
  };

  it('Store: aplica una vez y después responde already_applied', async () => {
    const { repo, actionId } = await seedStoreWorld();
    const base = { tenantId: TENANT_A, eventId: EVENT_ID, actionId, claimToken: 'owner-a' } as const;

    expect(await repo.checkpointReactivationStep({ ...base, step: 'timelineAdded' })).toBe('applied');
    expect(await repo.checkpointReactivationStep({ ...base, step: 'timelineAdded' })).toBe('already_applied');
  });

  it('Store: el owner vencido recibe ownership_lost y no escribe', async () => {
    const { repo, actionId } = await seedStoreWorld();
    store.PAYMENT_EVENTS[0].claimToken = 'owner-b';

    const outcome = await repo.checkpointReactivationStep({
      tenantId: TENANT_A, eventId: EVENT_ID, actionId, claimToken: 'owner-a', step: 'networkDispatched',
    });

    expect(outcome).toBe('ownership_lost');
    const [action] = await repo.listActions({ tenantId: TENANT_A, customerId: `${PREFIX}root` });
    expect(action.result?._webhookReactivationProgress).toBeUndefined();
  });

  it('Store: valida ownership ANTES de already_applied (stale + bit ya true)', async () => {
    const { repo, actionId } = await seedStoreWorld();
    const base = { tenantId: TENANT_A, eventId: EVENT_ID, actionId } as const;
    await repo.checkpointReactivationStep({ ...base, claimToken: 'owner-a', step: 'timelineAdded' });
    store.PAYMENT_EVENTS[0].claimToken = 'owner-b';

    // Si mirara primero el bit, A stale leería `already_applied` y seguiría
    // ejecutando el efecto siguiente con un lease que ya no posee.
    expect(
      await repo.checkpointReactivationStep({ ...base, claimToken: 'owner-a', step: 'timelineAdded' }),
    ).toBe('ownership_lost');
  });

  it('Store: es monotónico — marcar un paso no borra los de otro owner', async () => {
    const { repo, actionId } = await seedStoreWorld();
    const base = { tenantId: TENANT_A, eventId: EVENT_ID, actionId, claimToken: 'owner-a' } as const;
    await repo.checkpointReactivationStep({ ...base, step: 'customerReactivated' });
    await repo.checkpointReactivationStep({ ...base, step: 'networkDispatched' });
    await repo.checkpointReactivationStep({ ...base, step: 'alertCreated' });

    const [action] = await repo.listActions({ tenantId: TENANT_A, customerId: `${PREFIX}root` });
    expect(action.result?._webhookReactivationProgress).toEqual({
      customerReactivated: true,
      networkDispatched: true,
      alertCreated: true,
    });
  });

  it('Store: un paso fuera de la whitelist es error determinista, no un no-op', async () => {
    const { repo, actionId } = await seedStoreWorld();
    await expect(
      repo.checkpointReactivationStep({
        tenantId: TENANT_A, eventId: EVENT_ID, actionId, claimToken: 'owner-a',
        step: 'dropDatabase' as never,
      }),
    ).rejects.toThrow(/step/i);
  });

  it('Store: el vínculo event→action se valida; `triggeredBy` no basta', async () => {
    const { repo, actionId } = await seedStoreWorld();
    store.PAYMENT_EVENTS.push(claimedEvent(OTHER_EVENT_ID, TENANT_A, 'owner-x'));

    await expect(
      repo.checkpointReactivationStep({
        tenantId: TENANT_A, eventId: OTHER_EVENT_ID, actionId, claimToken: 'owner-x', step: 'timelineAdded',
      }),
    ).rejects.toThrow(/identidad can|canonical/i);
  });

  it('Supabase: mapea los tres estados de la RPC', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));
    const { action } = await repo.createActionIdempotent(rootAction());
    const base = { tenantId: TENANT_A, eventId: EVENT_ID, actionId: action.id } as const;

    expect(await repo.checkpointReactivationStep({ ...base, claimToken: 'owner-a', step: 'timelineAdded' }))
      .toBe('applied');
    expect(await repo.checkpointReactivationStep({ ...base, claimToken: 'owner-a', step: 'timelineAdded' }))
      .toBe('already_applied');
    expect(await repo.checkpointReactivationStep({ ...base, claimToken: 'owner-viejo', step: 'timelineAdded' }))
      .toBe('ownership_lost');
  });

  it('Supabase: RPC ausente es fail-closed (nunca se traduce a ausencia)', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));
    const { action } = await repo.createActionIdempotent(rootAction());
    db.dropRpc(CHECKPOINT_RPC);

    await expect(
      repo.checkpointReactivationStep({
        tenantId: TENANT_A, eventId: EVENT_ID, actionId: action.id, claimToken: 'owner-a', step: 'timelineAdded',
      }),
    ).rejects.toThrow();
  });

  it('Supabase: una respuesta desconocida no se interpreta como éxito', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    const repo = new SupabasePaymentRepository(asSupabaseClient<SupabaseClient>(db));
    const { action } = await repo.createActionIdempotent(rootAction());
    db.registerRpc(CHECKPOINT_RPC, () => 'quizas');

    await expect(
      repo.checkpointReactivationStep({
        tenantId: TENANT_A, eventId: EVENT_ID, actionId: action.id, claimToken: 'owner-a', step: 'timelineAdded',
      }),
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Identidad durable en cada destino
// ════════════════════════════════════════════════════════════════════

describe('Destinos idempotentes por actionId + step', () => {
  const KEY = stepIdempotencyKey('ma-1', 'timelineAdded');

  it('Timeline Store: la misma key devuelve la fila existente y estampa tenant', async () => {
    const repo = new StoreCustomersRepository();
    const event = {
      clientId: `${PREFIX}timeline`,
      eventType: 'status_change' as const,
      summary: 'Cambio de estado suspended → active',
    };
    await repo.addTimelineEvent(event, { tenantId: TENANT_A, idempotencyKey: KEY });
    await repo.addTimelineEvent(event, { tenantId: TENANT_A, idempotencyKey: KEY });

    const rows = store.CLIENT_TIMELINE.filter((e) => e.clientId === event.clientId);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(TENANT_A);
    expect(rows[0].idempotencyKey).toBe(KEY);
  });

  it('Timeline Store: sin key conserva el comportamiento histórico (no deduplica)', async () => {
    const repo = new StoreCustomersRepository();
    const event = {
      clientId: `${PREFIX}timeline-legacy`,
      eventType: 'note' as const,
      summary: 'Nota manual',
    };
    await repo.addTimelineEvent(event);
    await repo.addTimelineEvent(event);

    expect(store.CLIENT_TIMELINE.filter((e) => e.clientId === event.clientId)).toHaveLength(2);
  });

  it('Timeline Supabase: create-or-return sobre el índice único parcial', async () => {
    const db = supabaseWorld();
    const repo = new SupabaseCustomersRepository(asSupabaseClient<SupabaseClient>(db));
    const event = {
      clientId: `${PREFIX}timeline`,
      eventType: 'status_change' as const,
      summary: 'Cambio de estado suspended → active',
    };
    await repo.addTimelineEvent(event, { tenantId: TENANT_A, idempotencyKey: KEY });
    await repo.addTimelineEvent(event, { tenantId: TENANT_A, idempotencyKey: KEY });

    expect(db.rows('client_timeline')).toHaveLength(1);
    expect(db.rows('client_timeline')[0].tenant_id).toBe(TENANT_A);
  });

  it('Orden de reactivación Store: una sola fila durable por key', async () => {
    const repo = new StoreSuspensionRepository();
    const input = {
      customerId: `${PREFIX}order`,
      orderType: 'reactivation' as const,
      source: 'payment-engine' as const,
      reason: 'Pago confirmado',
      tenantId: TENANT_A,
      routerId: 'router-a',
      idempotencyKey: stepIdempotencyKey('ma-1', 'networkDispatched'),
    };
    const first = await repo.createOrder(input);
    const second = await repo.createOrder(input);

    expect(second.id).toBe(first.id);
    expect(engineStore.ORDERS.filter((o) => o.customerId === input.customerId)).toHaveLength(1);
    expect(first.tenantId).toBe(TENANT_A);
  });

  it('Orden de reactivación Supabase: estampa tenant/key y no crea la segunda fila', async () => {
    const db = supabaseWorld();
    const repo = new SupabaseSuspensionRepository(asSupabaseClient<SupabaseClient>(db));
    const input = {
      customerId: `${PREFIX}order`,
      orderType: 'reactivation' as const,
      source: 'payment-engine' as const,
      reason: 'Pago confirmado',
      tenantId: TENANT_A,
      routerId: 'router-a',
      idempotencyKey: stepIdempotencyKey('ma-1', 'networkDispatched'),
    };
    const first = await repo.createOrder(input);
    const second = await repo.createOrder(input);

    expect(second.id).toBe(first.id);
    expect(db.rows('reactivation_orders')).toHaveLength(1);
    expect(db.rows('reactivation_orders')[0].tenant_id).toBe(TENANT_A);
    expect(db.rows('reactivation_orders')[0].source).toBe('payment-engine');
  });

  it('Evento de suspensión Store/Supabase: una sola fila por key', async () => {
    const input = {
      customerId: `${PREFIX}event`,
      eventType: 'reactivation_order_created' as const,
      reason: 'Pago confirmado',
      automatic: true,
      tenantId: TENANT_A,
      idempotencyKey: stepIdempotencyKey('ma-1', 'suspensionEventRecorded'),
    };

    const storeRepo = new StoreSuspensionRepository();
    const storeFirst = await storeRepo.recordEvent(input);
    const storeSecond = await storeRepo.recordEvent(input);
    expect(storeSecond.id).toBe(storeFirst.id);
    expect(engineStore.EVENTS.filter((e) => e.customerId === input.customerId)).toHaveLength(1);

    const db = supabaseWorld();
    const dbRepo = new SupabaseSuspensionRepository(asSupabaseClient<SupabaseClient>(db));
    const dbFirst = await dbRepo.recordEvent(input);
    const dbSecond = await dbRepo.recordEvent(input);
    expect(dbSecond.id).toBe(dbFirst.id);
    expect(db.rows('suspension_events')).toHaveLength(1);
    expect(db.rows('suspension_events')[0].tenant_id).toBe(TENANT_A);
  });

  it('Alerta: existe destino idempotente en Store y en Supabase', async () => {
    const input = {
      tenantId: TENANT_A,
      idempotencyKey: stepIdempotencyKey('ma-1', 'alertCreated'),
      sourceType: 'client' as const,
      severity: 'info' as const,
      source: `${PREFIX}alerta`,
      message: 'Servicio reactivado por pago confirmado.',
    };

    const storeSink = new StoreAlertSink();
    expect(await storeSink.createAlertIdempotent(input)).toBe('created');
    expect(await storeSink.createAlertIdempotent(input)).toBe('existing');
    expect(store.NOC_ALERTS.filter((a) => a.source === input.source)).toHaveLength(1);

    const db = supabaseWorld();
    const dbSink = new SupabaseAlertSink(asSupabaseClient<SupabaseClient>(db));
    expect(await dbSink.createAlertIdempotent(input)).toBe('created');
    expect(await dbSink.createAlertIdempotent(input)).toBe('existing');
    expect(db.rows('noc_alerts')).toHaveLength(1);
    expect(db.rows('noc_alerts')[0].tenant_id).toBe(TENANT_A);
  });

  it('Tenants distintos no colisionan aunque compartan la key', async () => {
    const sink = new StoreAlertSink();
    const base = {
      idempotencyKey: stepIdempotencyKey('ma-1', 'alertCreated'),
      sourceType: 'client' as const,
      severity: 'info' as const,
      source: `${PREFIX}multi`,
      message: 'Servicio reactivado.',
    };
    await sink.createAlertIdempotent({ ...base, tenantId: TENANT_A });
    await sink.createAlertIdempotent({ ...base, tenantId: TENANT_B });

    expect(store.NOC_ALERTS.filter((a) => a.source === base.source)).toHaveLength(2);

    const db = supabaseWorld();
    const dbSink = new SupabaseAlertSink(asSupabaseClient<SupabaseClient>(db));
    await dbSink.createAlertIdempotent({ ...base, tenantId: TENANT_A });
    await dbSink.createAlertIdempotent({ ...base, tenantId: TENANT_B });
    expect(db.rows('noc_alerts')).toHaveLength(2);
  });

  it('Timeline Store/Supabase: misma key con details distintos es conflicto', async () => {
    const event = {
      clientId: `${PREFIX}timeline-conflict`,
      eventType: 'status_change' as const,
      summary: 'Cambio de estado suspended → active',
      details: 'Factura A',
      createdBy: 'owner-a',
    };
    const options = { tenantId: TENANT_A, idempotencyKey: KEY };

    const storeRepo = new StoreCustomersRepository();
    await storeRepo.addTimelineEvent(event, options);
    await expect(storeRepo.addTimelineEvent({ ...event, details: 'Factura B' }, options))
      .rejects.toBeInstanceOf(IdempotencyConflictError);

    const db = supabaseWorld();
    const dbRepo = new SupabaseCustomersRepository(asSupabaseClient<SupabaseClient>(db));
    await dbRepo.addTimelineEvent(event, options);
    await expect(dbRepo.addTimelineEvent({ ...event, details: 'Factura B' }, options))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Orden Store/Supabase: misma key con reason distinto es conflicto', async () => {
    const input = {
      customerId: `${PREFIX}order-conflict`,
      invoiceId: 'INV-A',
      orderType: 'reactivation' as const,
      source: 'payment-engine' as const,
      reason: 'Pago A',
      tenantId: TENANT_A,
      routerId: 'router-a',
      idempotencyKey: stepIdempotencyKey('ma-conflict', 'networkDispatched'),
    };

    const storeRepo = new StoreSuspensionRepository();
    await storeRepo.createOrder(input);
    await expect(storeRepo.createOrder({ ...input, reason: 'Pago B' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);

    const db = supabaseWorld();
    const dbRepo = new SupabaseSuspensionRepository(asSupabaseClient<SupabaseClient>(db));
    await dbRepo.createOrder(input);
    await expect(dbRepo.createOrder({ ...input, reason: 'Pago B' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Evento Store/Supabase: misma key con metadata distinta es conflicto', async () => {
    const input = {
      customerId: `${PREFIX}event-conflict`,
      invoiceId: 'INV-A',
      eventType: 'reactivation_order_created' as const,
      reason: 'Pago confirmado',
      automatic: true,
      actorId: 'owner-a',
      metadata: { dryRun: true, nested: { b: 2, a: 1 } },
      tenantId: TENANT_A,
      idempotencyKey: stepIdempotencyKey('ma-conflict', 'suspensionEventRecorded'),
    };

    const storeRepo = new StoreSuspensionRepository();
    await storeRepo.recordEvent(input);
    await expect(storeRepo.recordEvent({ ...input, metadata: { dryRun: false } }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);

    const db = supabaseWorld();
    const dbRepo = new SupabaseSuspensionRepository(asSupabaseClient<SupabaseClient>(db));
    await dbRepo.recordEvent(input);
    await expect(dbRepo.recordEvent({ ...input, metadata: { dryRun: false } }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Evento Store: metadata durable no comparte referencias mutables', async () => {
    const metadata = { nested: { value: 'original' } };
    const input = {
      customerId: `${PREFIX}event-copy`,
      eventType: 'reactivation_order_created' as const,
      reason: 'Pago confirmado',
      automatic: true,
      metadata,
      tenantId: TENANT_A,
      idempotencyKey: stepIdempotencyKey('ma-copy', 'suspensionEventRecorded'),
    };
    const repo = new StoreSuspensionRepository();
    const created = await repo.recordEvent(input);

    metadata.nested.value = 'mutated-input';
    (created.metadata!.nested as Record<string, unknown>).value = 'mutated-result';

    const recovered = await repo.recordEvent({ ...input, metadata: { nested: { value: 'original' } } });
    expect(recovered.metadata).toEqual({ nested: { value: 'original' } });
  });

  it('Alerta Store/Supabase: misma key con severidad distinta es conflicto', async () => {
    const input = {
      tenantId: TENANT_A,
      idempotencyKey: stepIdempotencyKey('ma-conflict', 'alertCreated'),
      sourceType: 'client' as const,
      severity: 'info' as const,
      source: `${PREFIX}alert-conflict`,
      message: 'Servicio reactivado.',
    };

    const storeSink = new StoreAlertSink();
    await storeSink.createAlertIdempotent(input);
    await expect(storeSink.createAlertIdempotent({ ...input, severity: 'warning' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);

    const db = supabaseWorld();
    const dbSink = new SupabaseAlertSink(asSupabaseClient<SupabaseClient>(db));
    await dbSink.createAlertIdempotent(input);
    await expect(dbSink.createAlertIdempotent({ ...input, severity: 'warning' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Billing atómico y recuperable
// ════════════════════════════════════════════════════════════════════

describe('Billing webhook atómico e idempotente', () => {
  const INVOICE_ID = 'INV-DURABLE-1';
  const KEY = webhookPaymentIdempotencyKey('openpay', 'tx-1');

  const seedStoreInvoice = () => {
    store.INVOICES.unshift({
      id: INVOICE_ID,
      clientId: `${PREFIX}billing`,
      clientName: 'Cliente durable',
      amount: 100,
      dateStr: '2026-07-01',
      dueDateStr: '2026-12-31',
      status: 'unpaid',
      cfdiStatus: 'pending',
      items: [],
      payments: [],
      tenantId: TENANT_A,
    });
    store.PAYMENT_EVENTS.push(claimedEvent());
  };

  it('Store: dos owners aplican un único pago y una única application', async () => {
    seedStoreInvoice();
    const repo = new StoreBillingRepository();
    const input = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    };

    const first = await repo.applyWebhookPayment(input);
    const second = await repo.applyWebhookPayment(input);

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('existing');
    const invoice = await repo.findInvoiceById(INVOICE_ID, TENANT_A);
    expect(invoice?.payments).toHaveLength(1);
    expect(invoice?.paidAmount).toBe(100);
    expect(invoice?.status).toBe('paid');
    expect(store.PAYMENT_ALLOCATIONS.filter((a) => a.invoiceId === INVOICE_ID)).toHaveLength(1);
  });

  it('Store: evt-A/evt-B del mismo provider transaction recuperan un único cobro', async () => {
    seedStoreInvoice();
    store.PAYMENT_EVENTS.push(claimedEvent(OTHER_EVENT_ID, TENANT_A, 'owner-b'));
    const repo = new StoreBillingRepository();
    const common = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-shared-between-events',
    };

    const first = await repo.applyWebhookPayment({
      ...common,
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', common.transactionId),
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    });
    const second = await repo.applyWebhookPayment({
      ...common,
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', common.transactionId),
      claim: { eventId: OTHER_EVENT_ID, claimToken: 'owner-b' },
    });

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('existing');
    expect(store.PAYMENT_ALLOCATIONS.filter((a) => a.invoiceId === INVOICE_ID)).toHaveLength(1);
  });

  it.each([
    {
      name: 'parcial vigente', dueDate: '2099-12-31', initialStatus: 'unpaid',
      initialCfdi: 'generated', amount: 25, expectedStatus: 'unpaid', expectedCfdi: 'pending', uuid: 'uuid-previo',
    },
    {
      name: 'parcial vencida', dueDate: '2020-01-01', initialStatus: 'overdue',
      initialCfdi: 'generated', amount: 25, expectedStatus: 'overdue', expectedCfdi: 'pending', uuid: 'uuid-previo',
    },
    {
      name: 'total', dueDate: '2099-12-31', initialStatus: 'unpaid',
      initialCfdi: 'pending', amount: 100, expectedStatus: 'paid', expectedCfdi: 'generated', uuid: undefined,
    },
    {
      name: 'cancelada terminal', dueDate: '2020-01-01', initialStatus: 'canceled',
      initialCfdi: 'canceled', amount: 25, expectedStatus: 'canceled', expectedCfdi: 'canceled', uuid: undefined,
    },
  ] as const)('Store: transición CFDI paritaria — $name', async (scenario) => {
    seedStoreInvoice();
    const invoice = store.INVOICES.find((row) => row.id === INVOICE_ID)!;
    invoice.dueDateStr = scenario.dueDate;
    invoice.status = scenario.initialStatus;
    invoice.cfdiStatus = scenario.initialCfdi;
    invoice.cfdiUuid = scenario.uuid;
    const repo = new StoreBillingRepository();

    const result = await repo.applyWebhookPayment({
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: scenario.amount,
      method: 'openpay',
      provider: 'openpay',
      transactionId: `tx-${scenario.name}`,
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', `tx-${scenario.name}`),
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    });

    expect(result.invoice).toMatchObject({
      status: scenario.expectedStatus,
      cfdiStatus: scenario.expectedCfdi,
    });
    if (scenario.expectedStatus === 'paid') expect(result.invoice?.cfdiUuid).toEqual(expect.any(String));
  });

  it('Store: un claim vencido devuelve ownership_lost sin tocar el ledger', async () => {
    seedStoreInvoice();
    const repo = new StoreBillingRepository();

    const result = await repo.applyWebhookPayment({
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-viejo' },
    });

    expect(result.outcome).toBe('ownership_lost');
    const invoice = await repo.findInvoiceById(INVOICE_ID, TENANT_A);
    expect(invoice?.payments).toHaveLength(0);
  });

  it('Store: la misma key con importe distinto es conflicto determinista', async () => {
    seedStoreInvoice();
    const repo = new StoreBillingRepository();
    const base = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    };
    await repo.applyWebhookPayment({ ...base, amount: 100 });

    await expect(repo.applyWebhookPayment({ ...base, amount: 40 }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Store: la misma key con método o transacción distintos es conflicto', async () => {
    seedStoreInvoice();
    const repo = new StoreBillingRepository();
    const base = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    };
    await repo.applyWebhookPayment(base);

    await expect(repo.applyWebhookPayment({ ...base, method: 'codi' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(repo.applyWebhookPayment({ ...base, transactionId: 'tx-otra' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Store Billing: la factura devuelta no comparte el ledger mutable', async () => {
    seedStoreInvoice();
    const repo = new StoreBillingRepository();
    const result = await repo.applyWebhookPayment({
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 25,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-copy',
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', 'tx-copy'),
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    });

    result.invoice!.payments[0].amount = 9_999;

    expect(store.INVOICES.find((invoice) => invoice.id === INVOICE_ID)?.payments[0].amount).toBe(25);
  });

  it('Supabase: la RPC deja un pago, una application y totales correctos', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    db.seed('invoices', [{
      id: INVOICE_ID,
      tenant_id: TENANT_A,
      client_id: `${PREFIX}billing`,
      client_name: 'Cliente durable',
      amount: 100,
      total_cents: 10_000,
      applied_cents: 0,
      amount_paid: 0,
      due_date: '2026-12-31',
      status: 'unpaid',
      cfdi_status: 'pending',
    }]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));
    const input = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    };

    const created = await repo.applyWebhookPayment(input);
    const existing = await repo.applyWebhookPayment(input);
    expect(created).toMatchObject({
      outcome: 'created',
      invoice: { status: 'paid', pendingAmount: 0 },
    });
    expect(existing).toMatchObject({
      outcome: 'existing',
      invoice: { status: 'paid', pendingAmount: 0 },
    });
    expect(db.rows('payments')).toHaveLength(1);
    expect(db.rows('payment_applications')).toHaveLength(1);
    expect(db.rows('invoices')[0].status).toBe('paid');
    expect(db.rows('invoices')[0].applied_cents).toBe(10_000);
  });

  it('Supabase simulator: evt-A/evt-B del mismo provider transaction recuperan un único cobro', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    seedClaim(db, claimedEvent(OTHER_EVENT_ID, TENANT_A, 'owner-b'));
    db.seed('invoices', [{
      id: INVOICE_ID,
      tenant_id: TENANT_A,
      client_id: `${PREFIX}billing`,
      client_name: 'Cliente durable',
      total_cents: 10_000,
      applied_cents: 0,
      due_date: '2026-12-31',
      status: 'unpaid',
      cfdi_status: 'pending',
    }]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));
    const common = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-shared-between-events',
    };

    expect((await repo.applyWebhookPayment({
      ...common,
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', common.transactionId),
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    })).outcome).toBe('created');
    expect((await repo.applyWebhookPayment({
      ...common,
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', common.transactionId),
      claim: { eventId: OTHER_EVENT_ID, claimToken: 'owner-b' },
    })).outcome).toBe('existing');
    expect(db.rows('payments')).toHaveLength(1);
    expect(db.rows('payment_applications')).toHaveLength(1);
  });

  it.each([
    {
      name: 'parcial vigente', dueDate: '2099-12-31', initialStatus: 'unpaid',
      initialCfdi: 'generated', amount: 25, expectedStatus: 'unpaid', expectedCfdi: 'pending', uuid: 'uuid-previo',
    },
    {
      name: 'parcial vencida', dueDate: '2020-01-01', initialStatus: 'overdue',
      initialCfdi: 'generated', amount: 25, expectedStatus: 'overdue', expectedCfdi: 'pending', uuid: 'uuid-previo',
    },
    {
      name: 'total', dueDate: '2099-12-31', initialStatus: 'unpaid',
      initialCfdi: 'pending', amount: 100, expectedStatus: 'paid', expectedCfdi: 'generated', uuid: null,
    },
    {
      name: 'cancelada terminal', dueDate: '2020-01-01', initialStatus: 'canceled',
      initialCfdi: 'canceled', amount: 25, expectedStatus: 'canceled', expectedCfdi: 'canceled', uuid: null,
    },
  ])('Supabase simulator: transición CFDI paritaria — $name', async (scenario) => {
    const db = supabaseWorld();
    seedClaim(db);
    db.seed('invoices', [{
      id: INVOICE_ID,
      tenant_id: TENANT_A,
      client_id: `${PREFIX}billing`,
      client_name: 'Cliente durable',
      total_cents: 10_000,
      applied_cents: 0,
      amount_paid: 0,
      due_date: scenario.dueDate,
      status: scenario.initialStatus,
      cfdi_status: scenario.initialCfdi,
      cfdi_uuid: scenario.uuid,
    }]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));

    await repo.applyWebhookPayment({
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: scenario.amount,
      method: 'openpay',
      provider: 'openpay',
      transactionId: `tx-${scenario.name}`,
      idempotencyKey: webhookPaymentIdempotencyKey('openpay', `tx-${scenario.name}`),
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    });

    const invoice = db.rows('invoices')[0];
    expect(invoice.status).toBe(scenario.expectedStatus);
    expect(invoice.cfdi_status).toBe(scenario.expectedCfdi);
    if (scenario.expectedStatus === 'paid') expect(invoice.cfdi_uuid).toEqual(expect.any(String));
  });

  it('Supabase: sin la RPC el pago no se aplica por la ruta insegura', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    db.dropRpc('billing_apply_webhook_payment');
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));

    await expect(repo.applyWebhookPayment({
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    })).rejects.toThrow();
    expect(db.rows('payments')).toHaveLength(0);
  });

  it('Supabase: la misma key con método o transacción distintos es conflicto', async () => {
    const db = supabaseWorld();
    seedClaim(db);
    db.seed('invoices', [{
      id: INVOICE_ID,
      tenant_id: TENANT_A,
      client_id: `${PREFIX}billing`,
      client_name: 'Cliente durable',
      total_cents: 10_000,
      applied_cents: 0,
      due_date: '2026-12-31',
      status: 'unpaid',
    }]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));
    const base = {
      invoiceId: INVOICE_ID,
      tenantId: TENANT_A,
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-1',
      idempotencyKey: KEY,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    };
    await repo.applyWebhookPayment(base);

    await expect(repo.applyWebhookPayment({ ...base, method: 'codi' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(repo.applyWebhookPayment({ ...base, transactionId: 'tx-otra' }))
      .rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('Supabase Billing: la misma key textual en tenants distintos no colisiona por PK', async () => {
    const db = supabaseWorld();
    seedClaim(db, claimedEvent(EVENT_ID, TENANT_A, 'owner-a'));
    seedClaim(db, claimedEvent(OTHER_EVENT_ID, TENANT_B, 'owner-b'));
    db.seed('invoices', [
      {
        id: `${INVOICE_ID}-A`, tenant_id: TENANT_A, client_id: `${PREFIX}billing-a`,
        client_name: 'Cliente A', total_cents: 10_000, applied_cents: 0,
        due_date: '2026-12-31', status: 'unpaid',
      },
      {
        id: `${INVOICE_ID}-B`, tenant_id: TENANT_B, client_id: `${PREFIX}billing-b`,
        client_name: 'Cliente B', total_cents: 10_000, applied_cents: 0,
        due_date: '2026-12-31', status: 'unpaid',
      },
    ]);
    const repo = new SupabaseBillingRepository(asSupabaseClient<SupabaseClient>(db));
    const common = {
      amount: 100,
      method: 'openpay',
      provider: 'openpay',
      transactionId: 'tx-shared',
      idempotencyKey: 'shared-key',
    };

    await expect(repo.applyWebhookPayment({
      ...common,
      invoiceId: `${INVOICE_ID}-A`,
      tenantId: TENANT_A,
      claim: { eventId: EVENT_ID, claimToken: 'owner-a' },
    })).resolves.toMatchObject({ outcome: 'created' });
    await expect(repo.applyWebhookPayment({
      ...common,
      invoiceId: `${INVOICE_ID}-B`,
      tenantId: TENANT_B,
      claim: { eventId: OTHER_EVENT_ID, claimToken: 'owner-b' },
    })).resolves.toMatchObject({ outcome: 'created' });
    expect(db.rows('payments')).toHaveLength(2);
    expect(db.rows('payment_applications')).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Capability antes del primer efecto
// ════════════════════════════════════════════════════════════════════

describe('Capability gate: schema + coherencia de flags', () => {
  it('Store + Store es un tuple soportado', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_BILLING', 'false');

    expect(await evaluateWebhookCapability(null)).toMatchObject({ ready: true });
  });

  it('Store + Store con destinos Supabase exige schema durable antes del primer efecto', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_BILLING', 'false');
    vi.stubEnv('USE_DB_CUSTOMERS', 'true');
    vi.stubEnv('USE_DB_SUSPENSION', 'true');
    const db = supabaseWorld();
    db.dropRpc(CAPABILITY_RPC);

    expect(await evaluateWebhookCapability(asSupabaseClient<SupabaseClient>(db))).toMatchObject({
      ready: false,
      code: 'schema_not_ready',
    });
  });

  it('Store + Store con destinos Supabase y schema completo sigue soportado', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_BILLING', 'false');
    vi.stubEnv('USE_DB_CUSTOMERS', 'true');
    vi.stubEnv('USE_DB_SUSPENSION', 'true');

    expect(await evaluateWebhookCapability(
      asSupabaseClient<SupabaseClient>(supabaseWorld()),
    )).toMatchObject({ ready: true });
  });

  it('Supabase + Supabase con schema completo es un tuple soportado', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'true');
    vi.stubEnv('USE_DB_BILLING', 'true');
    const db = supabaseWorld();

    expect(await evaluateWebhookCapability(asSupabaseClient<SupabaseClient>(db)))
      .toMatchObject({ ready: true });
  });

  it('Store Payments + Supabase Billing no es soportado', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_BILLING', 'true');
    const db = supabaseWorld();

    expect(await evaluateWebhookCapability(asSupabaseClient<SupabaseClient>(db))).toMatchObject({
      ready: false,
      code: 'persistence_tuple_mixed',
    });
  });

  it('Supabase Payments + Store Billing tampoco es soportado', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'true');
    vi.stubEnv('USE_DB_BILLING', 'false');
    const db = supabaseWorld();

    expect(await evaluateWebhookCapability(asSupabaseClient<SupabaseClient>(db))).toMatchObject({
      ready: false,
      code: 'persistence_tuple_mixed',
    });
  });

  it('schema viejo (RPC de capability ausente) deja el webhook no-ready', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'true');
    vi.stubEnv('USE_DB_BILLING', 'true');
    const db = supabaseWorld();
    db.dropRpc(CAPABILITY_RPC);

    expect(await evaluateWebhookCapability(asSupabaseClient<SupabaseClient>(db))).toMatchObject({
      ready: false,
      code: 'schema_not_ready',
    });
  });

  it('schema incompleto reporta exactamente qué falta', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'true');
    vi.stubEnv('USE_DB_BILLING', 'true');
    const db = supabaseWorld();
    db.registerRpc(CAPABILITY_RPC, () => ({
      ready: false,
      missing: ['mikrotik_actions.idempotency_key'],
    }));

    const capability = await evaluateWebhookCapability(asSupabaseClient<SupabaseClient>(db));
    expect(capability.ready).toBe(false);
    expect(capability.missing).toContain('mikrotik_actions.idempotency_key');
  });

  it('modo DB sin cliente Supabase configurado es no-ready, no degradación', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'true');
    vi.stubEnv('USE_DB_BILLING', 'true');

    expect(await evaluateWebhookCapability(null)).toMatchObject({
      ready: false,
      code: 'supabase_not_configured',
    });
  });

  it('el tuple mixto falla antes de reservar eventId o reclamar el evento', async () => {
    vi.stubEnv('USE_DB_PAYMENTS', 'false');
    vi.stubEnv('USE_DB_BILLING', 'true');
    const nextEventId = vi.fn(async () => 'no-debe-ejecutarse');
    const claimEvent = vi.fn();
    const service = new PaymentService({ nextEventId, claimEvent } as never);

    await expect(service.processWebhook({
      provider: 'openpay',
      providerEventId: 'evt-capability-before-effect',
      eventType: 'charge.succeeded',
      payload: {},
      tenantId: TENANT_A,
    })).rejects.toMatchObject({ statusCode: 503, code: 'WEBHOOK_NOT_READY' });
    expect(nextEventId).not.toHaveBeenCalled();
    expect(claimEvent).not.toHaveBeenCalled();
  });
});
