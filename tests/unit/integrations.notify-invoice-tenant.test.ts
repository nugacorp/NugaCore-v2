// ====================================================================
// MT-01 — aislamiento por WISP en `notifyInvoice` (PR-1A.3/1A.4).
//
// El fallo original: la ruta resolvía el tenant y lo pasaba, pero el servicio
// solo lo usaba para cargar las credenciales. La factura, el cliente, las
// torres y el timeline se buscaban por id a secas. Con el id de una factura
// ajena, un WISP:
//
//   - leía monto, vencimiento, nombre, teléfono y telegramChatId del cliente
//     de otro WISP;
//   - le enviaba un mensaje real CON SUS PROPIAS credenciales (fuga cruzada en
//     las dos direcciones a la vez);
//   - le escribía un evento en el timeline.
//
// Estos tests son adversariales: el atacante conoce IDs válidos del otro WISP.
// ====================================================================

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../backend/state/store';
import { StoreIntegrationsRepository } from '../../backend/domains/integrations/repository';
import { IntegrationsService } from '../../backend/domains/integrations/service';
import type { Client, Invoice } from '../../src/types';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const clientOf = (id: string, tenantId: string, name: string): Client => ({
  id,
  tenantId,
  name,
  type: 'residential',
  status: 'active',
  email: `${id}@example.test`,
  phone: `555-${id}`,
  address: 'calle 1',
  city: 'CDMX',
  lat: 19.4,
  lng: -99.1,
  planId: 'plan-basic',
  connectionType: 'WISP',
  ip: '10.0.0.1',
}) as Client;

const invoiceOf = (id: string, tenantId: string, clientId: string, clientName: string): Invoice => ({
  id,
  tenantId,
  clientId,
  clientName,
  amount: 500,
  dateStr: '2026-07-01',
  dueDateStr: '2026-07-15',
  status: 'unpaid',
  cfdiStatus: 'pending',
  items: [{ description: 'Servicio de Internet - Julio 2026', price: 500, qty: 1 }],
  payments: [],
}) as unknown as Invoice;

describe('notifyInvoice — aislamiento por WISP (MT-01)', () => {
  let svc: IntegrationsService;

  beforeEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    store.CLIENTS = [
      clientOf('c-a', TENANT_A, 'Cliente del WISP A'),
      clientOf('c-b', TENANT_B, 'Cliente del WISP B'),
    ];
    store.INVOICES = [
      invoiceOf('fac-a', TENANT_A, 'c-a', 'Cliente del WISP A'),
      invoiceOf('fac-b', TENANT_B, 'c-b', 'Cliente del WISP B'),
    ] as never;
    store.CLIENT_TIMELINE = [];
    svc = new IntegrationsService(new StoreIntegrationsRepository());
  });

  afterEach(() => {
    store.INTEGRATION_SETTINGS = null;
    store.INTEGRATION_SETTINGS_BY_TENANT = {};
    store.CLIENT_TIMELINE = [];
  });

  it('el WISP A NO puede notificar una factura del WISP B', async () => {
    await expect(svc.notifyInvoice('fac-b', TENANT_A)).rejects.toThrow(/Factura no encontrada/);
  });

  it('responde 404 y no 403: un 403 confirmaría que la factura existe', async () => {
    // Mismo mensaje para "no existe" y "es de otro WISP": indistinguibles.
    const ajena = await captureError(() => svc.notifyInvoice('fac-b', TENANT_A));
    const inexistente = await captureError(() => svc.notifyInvoice('fac-inventada', TENANT_A));
    expect(ajena.message).toBe(inexistente.message);
    expect((ajena as { status?: number }).status ?? 404).toBe(404);
  });

  it('el WISP A NO puede leer los datos del cliente del WISP B', async () => {
    const err = await captureError(() => svc.notifyInvoice('fac-b', TENANT_A));
    // Nada del cliente ajeno puede aparecer en el error.
    expect(err.message).not.toContain('Cliente del WISP B');
    expect(err.message).not.toContain('555-c-b');
    expect(err.message).not.toContain('c-b');
  });

  it('el WISP A NO puede escribir en el timeline del cliente del WISP B', async () => {
    await svc.notifyInvoice('fac-b', TENANT_A).catch(() => undefined);
    const ajenos = store.CLIENT_TIMELINE.filter((e) => e.clientId === 'c-b');
    expect(ajenos, 'no debe haberse escrito nada en el timeline de B').toHaveLength(0);
  });

  it('el WISP A NO puede enviar con SUS credenciales al cliente del WISP B', async () => {
    // El caso que el hallazgo original no nombraba y que es el más grave: la
    // fuga va en las dos direcciones — datos de B hacia A, y credenciales de A
    // usadas contra un cliente de B.
    await expect(svc.notifyInvoice('fac-b', TENANT_A)).rejects.toThrow();
    expect(store.CLIENT_TIMELINE).toHaveLength(0);
  });

  it('el WISP A SÍ puede notificar su propia factura', async () => {
    const res = await svc.notifyInvoice('fac-a', TENANT_A);
    expect(res.clientId).toBe('c-a');
    expect(res).toHaveProperty('sent');
  });

  it('la auditoría queda en el cliente correcto', async () => {
    await svc.notifyInvoice('fac-a', TENANT_A);
    const eventos = store.CLIENT_TIMELINE.filter((e) => e.clientId === 'c-a');
    expect(eventos.length).toBeGreaterThan(0);
    expect(store.CLIENT_TIMELINE.filter((e) => e.clientId === 'c-b')).toHaveLength(0);
  });

  it('simétrico: B tampoco alcanza la factura de A', async () => {
    await expect(svc.notifyInvoice('fac-a', TENANT_B)).rejects.toThrow(/Factura no encontrada/);
    const res = await svc.notifyInvoice('fac-b', TENANT_B);
    expect(res.clientId).toBe('c-b');
  });
});

describe('notifyInvoice — contrato', () => {
  it('tenantId es obligatorio en la firma', () => {
    const source = readFileSyncCached('backend/domains/integrations/service.ts');
    expect(source).toMatch(/async notifyInvoice\(invoiceId: string, tenantId: string\)/);
    expect(source, 'tenantId no debe volver a ser opcional').not.toMatch(
      /async notifyInvoice\([^)]*tenantId\?:/,
    );
  });

  it('todas las consultas del flujo van acotadas por tenant', () => {
    const source = readFileSyncCached('backend/domains/integrations/service.ts');
    expect(source).toContain('findInvoiceById(invoiceId, tenantId)');
    expect(source).toContain('getById(invoice.clientId, tenantId)');
    expect(source).toContain('resolveBillingCycleLabel(client.billingZoneId, tenantId)');
    expect(source).toContain('listTowers({ tenantId })');
    expect(source).toContain('getTowerOnboarding(tower.id, tenantId)');
  });
});

function readFileSyncCached(path: string): string {
  return readFileSync(path, 'utf8');
}

async function captureError(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Expected action to reject');
}
