// ====================================================================
// Fixup 06 — findings P3 de la revisión fría R3.
//
// P3-1 · Guardarraíl versionado contra doble codificación UTF-8.
//   Dos de las cadenas afectadas son mensajes de error que `errorHandler`
//   serializa tal cual en el cuerpo JSON de la respuesta, así que el texto
//   corrupto es user-facing. El escaneo cubre toda la superficie de fuentes
//   de la serie T5 (backend, src, migraciones y tests) para que no vuelva a
//   colarse por otra cadena.
//
// P3-2 · CoDi sin importe sobre una factura sin saldo pendiente.
//   La cadena `??` no salta el 0, así que un `pendingAmount` saldado llegaba
//   a Billing como importe 0 y producía un 400 no retryable: el proveedor no
//   reintenta y el cobro se pierde en silencio. Debe ser 503 retryable, sin
//   cerrar el evento y sin inventar un importe a partir del total facturado.
// ====================================================================

import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorePaymentRepository } from '../../backend/domains/payments/repository';
import { PaymentService } from '../../backend/domains/payments/service';
import { engineStore } from '../../backend/domains/suspension/engine-store';
import { store, type MikrotikRouterRegistryItem } from '../../backend/state/store';
import type { Client, Invoice } from '../../src/types';

// ── P3-1 · doble codificación UTF-8 ─────────────────────────────────

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Raíces de fuentes que contienen toda la superficie tocada por T5. */
const SOURCE_ROOTS = ['backend', 'src', 'supabase/migrations', 'tests'];
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.sql'];
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

// Puntos de código de la corrupción: un texto UTF-8 leído como Latin-1 y
// re-codificado deja siempre un carácter U+00C2/U+00C3 seguido de un byte de
// continuación U+0080-U+00BF. Se comparan por código y no por literal: escribir
// la secuencia en el fuente haría que este archivo se delatara a sí mismo y el
// guardarraíl no podría pasar nunca.
const MOJIBAKE_LEAD_LOW = 0xc2;
const MOJIBAKE_LEAD_HIGH = 0xc3;
const MOJIBAKE_TRAIL_LOW = 0x80;
const MOJIBAKE_TRAIL_HIGH = 0xbf;

const isDoubleEncoded = (text: string): boolean => {
  for (let i = 0; i < text.length - 1; i += 1) {
    const lead = text.charCodeAt(i);
    if (lead !== MOJIBAKE_LEAD_LOW && lead !== MOJIBAKE_LEAD_HIGH) continue;
    const trail = text.charCodeAt(i + 1);
    if (trail >= MOJIBAKE_TRAIL_LOW && trail <= MOJIBAKE_TRAIL_HIGH) return true;
  }
  return false;
};

const collectSourceFiles = (relativeRoot: string): string[] => {
  const absoluteRoot = `${repoRoot}${relativeRoot}`;
  const found: string[] = [];
  const walk = (dir: string, relative: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIPPED_DIRS.has(entry)) continue;
      const absolute = `${dir}/${entry}`;
      const relativePath = relative ? `${relative}/${entry}` : entry;
      if (statSync(absolute).isDirectory()) {
        walk(absolute, relativePath);
      } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        found.push(`${relativeRoot}/${relativePath}`);
      }
    }
  };
  walk(absoluteRoot, '');
  return found;
};

const sourceFiles = SOURCE_ROOTS.flatMap(collectSourceFiles);

describe('Fixup 06 · sin doble codificación UTF-8 en las fuentes', () => {
  it('cubre la superficie de la serie T5', () => {
    // Si el guardarraíl dejara de alcanzar estos archivos, las cadenas
    // corregidas podrían volver a corromperse sin que nada fallara.
    for (const covered of [
      'backend/domains/payments/service.ts',
      'backend/domains/billing/repository.ts',
      'supabase/migrations/20260730150000_webhook_durable_idempotency.sql',
    ]) {
      expect(sourceFiles).toContain(covered);
    }
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it('ninguna línea contiene secuencias doble-codificadas', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(`${repoRoot}${file}`, 'utf8');
      if (!isDoubleEncoded(text)) continue;
      text.split('\n').forEach((line, index) => {
        if (isDoubleEncoded(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// ── P3-2 · CoDi sin importe resoluble ───────────────────────────────

const TENANT = 'tenant-fixup-06';
const CUSTOMER = 'c-1';
const INVOICE = 'fac-103';
const REFERENCE = 'FAC-103-C-1';

const client = (): Client => ({
  id: CUSTOMER, tenantId: TENANT, name: 'Cliente fixup 06', type: 'residential', status: 'suspended',
  email: 'c-1@example.test', phone: '0000000000', address: 'Fixture', city: 'Fixture',
  lat: 0, lng: 0, planId: 'plan-fixup-06', ip: '192.0.2.60', pppoeUser: 'pppoe-c-1',
  routerId: 'router-fixup-06',
});

const invoice = (payments: Invoice['payments'] = []): Invoice => ({
  id: INVOICE, tenantId: TENANT, clientId: CUSTOMER, clientName: 'Cliente fixup 06', amount: 100,
  dateStr: '2026-08-01', dueDateStr: '2099-12-31', status: 'unpaid', cfdiStatus: 'pending',
  items: [], payments,
});

const router = (): MikrotikRouterRegistryItem => ({
  id: 'router-fixup-06', tenantId: TENANT, name: 'Router fixup 06', ipAddress: '192.0.2.1',
  apiPort: 8728, username: 'fixture', encryptedPassword: 'fixture', isOnline: true,
  cpuUsagePct: 0, memoryUsagePct: 0, routerOsVersion: '7.15',
  lastHealthCheckAt: new Date().toISOString(),
});

const processCodi = (providerEventId: string, payload: Record<string, unknown>) =>
  new PaymentService(new StorePaymentRepository()).processWebhook({
    provider: 'codi', providerEventId, eventType: 'payment.completed', tenantId: TENANT,
    payload: { status: 'paid', reference: REFERENCE, ...payload },
  });

beforeEach(() => {
  vi.stubEnv('USE_DB_PAYMENTS', 'false');
  vi.stubEnv('USE_DB_BILLING', 'false');
  vi.stubEnv('USE_DB_CUSTOMERS', 'false');
  vi.stubEnv('USE_DB_SUSPENSION', 'false');
  vi.stubEnv('PAYMENTS_ROUTER_LIVE', 'false');
  store.CLIENTS = [];
  store.INVOICES = [];
  store.PAYMENT_ALLOCATIONS = [];
  store.PAYMENT_ORDERS = [];
  store.PAYMENT_EVENTS = [];
  store.MIKROTIK_ACTIONS = [];
  store.CLIENT_TIMELINE = [];
  store.NOC_ALERTS = [];
  store.MIKROTIK_ROUTERS = [];
  engineStore.EVENTS = [];
  engineStore.ORDERS = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Fixup 06 · CoDi sin importe sobre factura sin pendiente', () => {
  it('queda retryable (503) sin cerrar el evento ni escribir efectos', async () => {
    store.CLIENTS.push(client());
    // Saldada por otro medio: el pendiente es 0 y no hay cobro CoDi previo.
    store.INVOICES.push(invoice([{ date: '2026-08-02', amount: 100, method: 'Efectivo' }]));
    store.MIKROTIK_ROUTERS.push(router());

    await expect(processCodi('codi-sin-importe', {})).rejects.toMatchObject({
      statusCode: 503,
      code: 'CODI_AMOUNT_UNRESOLVED',
    });

    expect(store.PAYMENT_EVENTS).toHaveLength(1);
    expect(store.PAYMENT_EVENTS[0]).toMatchObject({ processed: false });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(0);
    expect(store.MIKROTIK_ACTIONS).toHaveLength(0);
    expect(store.CLIENTS[0].status).toBe('suspended');
  });

  it('no inventa el importe a partir del total facturado', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice([{ date: '2026-08-02', amount: 100, method: 'Efectivo' }]));

    await expect(processCodi('codi-sin-importe-2', {})).rejects.toMatchObject({ statusCode: 503 });

    // El único cobro sigue siendo el manual: no se registró uno de 100 por CoDi.
    expect(store.INVOICES[0].payments).toHaveLength(1);
    expect(store.INVOICES[0].payments[0]).toMatchObject({ method: 'Efectivo' });
  });

  it('un pendiente > 0 sigue resolviendo el importe sin que el webhook lo traiga', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice([{ date: '2026-08-02', amount: 40, method: 'Efectivo' }]));
    store.MIKROTIK_ROUTERS.push(router());

    const result = await processCodi('codi-pendiente-positivo', {});

    expect(result).toMatchObject({ invoiceUpdated: true, reactivationTriggered: true });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
    expect(store.PAYMENT_ALLOCATIONS[0].amount).toBe(60);
  });

  it('la redelivery del mismo cobro CoDi ya aplicado se resuelve por el pago existente', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    store.MIKROTIK_ROUTERS.push(router());

    const first = await processCodi('codi-primera-entrega', { amount: 100 });
    expect(first).toMatchObject({ invoiceUpdated: true });

    // Otro providerEventId, misma referencia y sin importe: la factura ya no
    // tiene pendiente, pero el cobro CoDi previo identifica el importe.
    const redelivery = await processCodi('codi-redelivery-sin-importe', {});

    expect(redelivery).toMatchObject({ invoiceUpdated: true });
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(1);
  });

  it('un importe explícito inválido sigue siendo 400 antes de cualquier lookup', async () => {
    store.CLIENTS.push(client());
    store.INVOICES.push(invoice());
    const listOrders = vi.spyOn(StorePaymentRepository.prototype, 'listOrders');
    const findOrder = vi.spyOn(StorePaymentRepository.prototype, 'findOrderByProviderOrderId');

    await expect(processCodi('codi-importe-invalido', { amount: -5 })).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(listOrders).not.toHaveBeenCalled();
    expect(findOrder).not.toHaveBeenCalled();
    expect(store.PAYMENT_ALLOCATIONS).toHaveLength(0);
  });
});
