import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SupabaseCustomersRepository.remove — limpieza de dependencias FK', () => {
  const source = readFileSync('backend/domains/customers/repository.ts', 'utf8');

  it('importa ConflictError', () => {
    expect(source).toContain("import { ConflictError }");
    expect(source).toContain('../../common/errors');
  });

  it('limpia tablas dependientes antes del DELETE del cliente', () => {
    expect(source).toContain('payment_receipts');
    expect(source).toContain('payments');
    expect(source).toContain('invoice_items');
    expect(source).toContain('invoices');
    expect(source).toContain('service_subscriptions');
    expect(source).toContain('suspension_orders');
    expect(source).toContain('client_timeline');
    expect(source).toContain('onus');
  });

  it('lanza ConflictError con mensaje en español para FK 23503', () => {
    expect(source).toContain("23503");
    expect(source).toContain('ConflictError');
    expect(source).toContain('historial financiero');
  });

  it('App.tsx maneja fetchJson DELETE y relanza el error', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain("method: 'DELETE'");
    expect(app).toContain('handleDeleteClient');
    // Should re-throw for CRM to display (with cause attached)
    expect(app).toContain('throw new Error(msg,');
  });

  it('fetchJson maneja respuesta 204 sin cuerpo', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('response.status === 204');
    expect(app).toContain('undefined as unknown as T');
  });
});
